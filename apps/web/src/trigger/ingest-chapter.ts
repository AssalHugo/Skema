/**
 * Génération d'un chapitre, lancée à la demande :
 *   1. écriture des lots de 25–30 pages du chapitre sur R2 (gcp-worker) ;
 *   2. pour chaque lot, en parallèle (file `gemini-vision`) : détection des
 *      schémas (Gemini Vision, boîtes 0..1000) → `/crop-bboxes` → WebP sur R2
 *      → `course_diagrams` ;
 *   3. découpage du chapitre en 8 à 20 concepts (modèle QUALITY) ;
 *   4. fan-out des moteurs 2 et 1 pour les concepts de ce chapitre uniquement.
 */
import { AbortTaskRunError, logger, schemaTask, type TaskOutput } from "@trigger.dev/sdk";
import { and, asc, between, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { deleteGeminiFile, uploadGeminiFile, type GeminiFileRef } from "@/lib/ai/gemini";
import { getDb, schema, type Database } from "@/lib/db";
import type { ChapterBatch } from "@/lib/db/schema";
import { ingestEnv } from "@/lib/env";
import { extractConcepts } from "@/lib/ingest/concepts";
import { detectFiguresGemini, detectFiguresMistral, type DetectionResult } from "@/lib/ingest/figures";
import { courseKeys } from "@/lib/ingest/keys";
import {
  deleteObjects,
  getObjectBytes,
  getPresignedDownloadUrl,
  getPresignedPutUrl,
  uploadBufferToR2,
} from "@/lib/storage/r2";
import { cropBboxes, splitPdf, type CropResult } from "@/lib/worker/client";
import { curateYoutube } from "./curate-youtube";
import { abortIfPermanent, errorMessage } from "./errors";
import { generateEpisode } from "./generate-episode";

const { courses, chapters, courseDiagrams, concepts } = schema;

/** Gemini et /crop-bboxes : au plus 4 lots traités en même temps, tous chapitres confondus. */
const VISION_CONCURRENCY = 4;
/** Limite de la Files API Gemini pour un PDF. */
const GEMINI_MAX_FILE_BYTES = 50_000_000;

const GeminiFile = z.object({ name: z.string(), uri: z.string(), mimeType: z.string() });

// ---------------------------------------------------------------------------
// Sous-tâche : un lot de pages
// ---------------------------------------------------------------------------

export const extractBatchFigures = schemaTask({
  id: "extract-batch-figures",
  schema: z.object({
    courseId: z.uuid(),
    chapterId: z.uuid(),
    discipline: z.string(),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    r2Key: z.string(),
    geminiFile: GeminiFile.optional(),
    extractor: z.enum(["gemini", "mistral"]),
  }),
  queue: { name: "gemini-vision", concurrencyLimit: VISION_CONCURRENCY },
  maxDuration: 600,
  run: async (p) => {
    const db = getDb();
    const batchLabel = `p${p.pageStart}-${p.pageEnd}`;
    const ctx = { courseId: p.courseId, chapterId: p.chapterId, discipline: p.discipline, batchLabel };
    const sourceUrl = await getPresignedDownloadUrl(p.r2Key);

    let detection: DetectionResult;
    if (p.extractor === "mistral") {
      const apiKey = ingestEnv().MISTRAL_API_KEY;
      if (!apiKey) throw new AbortTaskRunError("PDF_EXTRACTOR=mistral sans MISTRAL_API_KEY");
      detection = await detectFiguresMistral(sourceUrl, apiKey, ctx);
    } else {
      if (!p.geminiFile) throw new AbortTaskRunError("Fichier Gemini manquant pour le lot");
      detection = await detectFiguresGemini(p.geminiFile, ctx);
    }

    const crop: CropResult = detection.figures.length
      ? await abortIfPermanent(() => cropBboxes(sourceUrl, detection.figures))
      : emptyCrop();

    // Relance idempotente : on remplace les schémas déjà extraits de ce lot.
    await deleteDiagrams(
      db,
      and(eq(courseDiagrams.chapterId, p.chapterId), between(courseDiagrams.pageNumber, p.pageStart, p.pageEnd)),
    );

    const rows: (typeof courseDiagrams.$inferInsert)[] = [];
    const cutTextIds: string[] = [];
    for (const c of crop.crops) {
      const fig = detection.figures[c.index];
      const id = crypto.randomUUID();
      const key = courseKeys.diagram(p.courseId, id);
      await uploadBufferToR2({ key, body: Buffer.from(c.webp_base64, "base64"), contentType: "image/webp" });
      const [ymin, xmin, ymax, xmax] = fig.box2d;
      rows.push({
        id,
        courseId: p.courseId,
        chapterId: p.chapterId,
        pageNumber: p.pageStart + c.page - 1,
        r2ImageKey: key,
        width: c.width,
        height: c.height,
        caption: fig.caption || null,
        aiDescription: fig.description || fig.caption || "Schéma du cours",
        bboxJson: { ymin, xmin, ymax, xmax },
      });
      if (c.cut_text.length) cutTextIds.push(id);
    }
    if (rows.length) await db.insert(courseDiagrams).values(rows);
    if (crop.invalid.length) logger.warn("Boîtes invalides ignorées", { batchLabel, invalid: crop.invalid });

    return {
      pageStart: p.pageStart,
      pageEnd: p.pageEnd,
      provider: detection.provider,
      model: detection.model,
      costUsd: detection.costUsd,
      figures: crop.metrics.figures,
      cropped: crop.metrics.cropped,
      invalid: crop.invalid.length,
      cutText: cutTextIds.length,
      cutTextDiagramIds: cutTextIds,
      avgKb: crop.metrics.avg_kb,
    };
  },
});

function emptyCrop(): CropResult {
  return {
    page_count: 0,
    crops: [],
    invalid: [],
    metrics: {
      figures: 0,
      cropped: 0,
      invalid_box_ratio: 0,
      cut_text_ratio: 0,
      avg_kb: 0,
      verdict: { ok: true, fails: [] },
    },
  };
}

async function deleteDiagrams(db: Database, where: SQL | undefined): Promise<number> {
  const removed = await db
    .delete(courseDiagrams)
    .where(where)
    .returning({ key: courseDiagrams.r2ImageKey });
  if (removed.length) await deleteObjects(removed.map((r) => r.key));
  return removed.length;
}

// ---------------------------------------------------------------------------
// Tâche principale : un chapitre
// ---------------------------------------------------------------------------

/** Seuils d'échec de S.2 (spikes/RESULTS.md). */
export const S2_THRESHOLDS = { cutTextRatioMax: 0.1, invalidBoxRatioMax: 0.05 };

export const ingestChapter = schemaTask({
  id: "ingest-chapter",
  schema: z.object({ chapterId: z.uuid() }),
  queue: { name: "ingest-chapter", concurrencyLimit: 2 },
  // Lots PDF (≤ 40 Mo chacun) chargés en mémoire pour la Files API Gemini.
  machine: "small-2x",
  maxDuration: 900,
  // Un nouvel essai refait tout le chapitre (Gemini compris) : on se limite à un.
  retry: { maxAttempts: 2 },
  run: async ({ chapterId }) => {
    const db = getDb();
    const [row] = await db
      .select({ chapter: chapters, course: courses })
      .from(chapters)
      .innerJoin(courses, eq(chapters.courseId, courses.id))
      .where(eq(chapters.id, chapterId));
    if (!row) throw new AbortTaskRunError(`Chapitre introuvable : ${chapterId}`);
    const { chapter, course } = row;
    if (course.status !== "ready") throw new AbortTaskRunError(`Cours non ingéré (${course.status})`);
    if (!chapter.batches.length) throw new AbortTaskRunError("Chapitre sans lot de pages");

    const extractor = ingestEnv().PDF_EXTRACTOR;
    const discipline = course.discipline ?? "biologie";
    const pdfKey = course.pdfR2Key ?? course.sourceR2Key;
    await db.update(chapters).set({ status: "processing", error: null }).where(eq(chapters.id, chapterId));

    // 0. Relance : on repart de zéro pour ce chapitre (les épisodes suivent par cascade).
    await db.delete(concepts).where(eq(concepts.chapterId, chapterId));
    const removed = await deleteDiagrams(db, eq(courseDiagrams.chapterId, chapterId));
    if (removed) logger.info("Anciens schémas supprimés", { removed });

    // 1. Lots du chapitre sur R2 (le document entier sert directement s'il tient en un lot).
    const batches: Required<ChapterBatch>[] = chapter.batches.map((b) => ({
      ...b,
      r2Key: b.wholeDocument ? pdfKey : courseKeys.batch(course.id, chapterId, b.pageStart, b.pageEnd),
    }));
    const toSplit = batches.filter((b) => !b.wholeDocument);
    if (toSplit.length) {
      const uploads = await Promise.all(
        toSplit.map(async (b) => ({
          pageStart: b.pageStart,
          pageEnd: b.pageEnd,
          putUrl: await getPresignedPutUrl({ key: b.r2Key, contentType: "application/pdf" }),
        })),
      );
      const split = await abortIfPermanent(async () => splitPdf(await getPresignedDownloadUrl(pdfKey), uploads));
      for (const u of split.uploads) {
        const b = batches.find((x) => x.pageStart === u.page_start && x.pageEnd === u.page_end);
        if (b) b.bytes = u.bytes;
      }
    }
    const tooBig = batches.find((b) => (b.bytes ?? 0) > GEMINI_MAX_FILE_BYTES);
    if (tooBig) {
      throw new AbortTaskRunError(`Lot p. ${tooBig.pageStart}–${tooBig.pageEnd} trop lourd (${tooBig.bytes} octets)`);
    }
    await db.update(chapters).set({ batches }).where(eq(chapters.id, chapterId));

    // 2. Lots envoyés à la Files API Gemini (détection des schémas + concepts).
    const files: GeminiFileRef[] = [];
    try {
      for (const b of batches) {
        const bytes = await getObjectBytes(b.r2Key);
        files.push(
          await uploadGeminiFile(bytes, "application/pdf", `chapter-${chapterId}-p${b.pageStart}-${b.pageEnd}`),
        );
      }

      // 3. Schémas, un lot par sous-tâche (en parallèle, file gemini-vision).
      const results = await extractBatchFigures.batchTriggerAndWait(
        batches.map((b, i) => ({
          payload: {
            courseId: course.id,
            chapterId,
            discipline,
            pageStart: b.pageStart,
            pageEnd: b.pageEnd,
            r2Key: b.r2Key,
            geminiFile: files[i],
            extractor,
          },
        })),
      );
      const failed = results.runs.filter((r) => !r.ok);
      if (failed.length) {
        throw new Error(`${failed.length}/${batches.length} lot(s) en échec lors de l'extraction des schémas`);
      }
      const outputs = results.runs.flatMap((r) => (r.ok ? [r.output] : []));
      const metrics = aggregateMetrics(outputs);
      if (!metrics.verdict.ok) logger.warn("Seuils S.2 dépassés sur ce chapitre", metrics);

      // 4. Concepts du chapitre, reliés à ses schémas.
      const diagrams = await db
        .select({
          id: courseDiagrams.id,
          pageNumber: courseDiagrams.pageNumber,
          caption: courseDiagrams.caption,
          aiDescription: courseDiagrams.aiDescription,
        })
        .from(courseDiagrams)
        .where(eq(courseDiagrams.chapterId, chapterId))
        .orderBy(asc(courseDiagrams.pageNumber));
      const extracted = await extractConcepts({
        courseId: course.id,
        chapterId,
        chapterTitle: chapter.title,
        pageStart: chapter.pageStart,
        pageEnd: chapter.pageEnd,
        discipline,
        files: batches.map((b, i) => ({ file: files[i], pageStart: b.pageStart, pageEnd: b.pageEnd })),
        diagrams,
      });
      if (!extracted.concepts.length) throw new Error("Aucun concept extrait de ce chapitre");
      const inserted = await db
        .insert(concepts)
        .values(
          extracted.concepts.map((c, i) => ({
            courseId: course.id,
            chapterId,
            chapterTitle: chapter.title,
            title: c.title,
            summary: c.summary,
            keywords: c.keywords,
            sourcePages: c.sourcePages,
            diagramIds: c.diagramIds,
            orderIndex: i,
          })),
        )
        .returning({ id: concepts.id });

      const costUsd = outputs.reduce((s, o) => s + o.costUsd, 0) + extracted.costUsd;
      await db
        .update(chapters)
        .set({ status: "ready", metrics: { ...metrics, concepts: inserted.length, costUsd } })
        .where(eq(chapters.id, chapterId));

      // 5. Fan-out des moteurs 2 et 1, pour ce chapitre uniquement.
      if (inserted.length) {
        const items = inserted.map((c) => ({ payload: { conceptId: c.id } }));
        await Promise.all([generateEpisode.batchTrigger(items), curateYoutube.batchTrigger(items)]);
      }

      return { chapterId, concepts: inserted.length, diagrams: diagrams.length, costUsd, metrics };
    } finally {
      await Promise.all(files.map((f) => deleteGeminiFile(f.name)));
    }
  },
  onFailure: async ({ payload, error }) => {
    await getDb()
      .update(chapters)
      .set({ status: "failed", error: errorMessage(error) })
      .where(eq(chapters.id, payload.chapterId));
  },
});

type BatchOutput = TaskOutput<typeof extractBatchFigures>;

export function aggregateMetrics(
  outputs: Pick<BatchOutput, "figures" | "cropped" | "invalid" | "cutText" | "avgKb" | "cutTextDiagramIds">[],
) {
  const figures = outputs.reduce((s, o) => s + o.figures, 0);
  const cropped = outputs.reduce((s, o) => s + o.cropped, 0);
  const invalid = outputs.reduce((s, o) => s + o.invalid, 0);
  const cut = outputs.reduce((s, o) => s + o.cutText, 0);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const cutTextRatio = cropped ? round(cut / cropped) : 0;
  const invalidBoxRatio = figures ? round(invalid / figures) : 0;
  const fails = [
    ...(cutTextRatio > S2_THRESHOLDS.cutTextRatioMax ? ["cut_text_ratio"] : []),
    ...(invalidBoxRatio > S2_THRESHOLDS.invalidBoxRatioMax ? ["invalid_box_ratio"] : []),
  ];
  return {
    batches: outputs.length,
    figures,
    cropped,
    cutTextRatio,
    invalidBoxRatio,
    avgKb: cropped ? round(outputs.reduce((s, o) => s + o.avgKb * o.cropped, 0) / cropped) : 0,
    cutTextDiagramIds: outputs.flatMap((o) => o.cutTextDiagramIds),
    verdict: { ok: fails.length === 0, fails, thresholds: S2_THRESHOLDS },
  };
}
