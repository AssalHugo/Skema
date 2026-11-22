/**
 * Ingestion légère à l'upload : conversion éventuelle du diaporama en PDF,
 * détection des chapitres et des lots de pages par gcp-worker, puis création
 * des `chapters` en base. Aucune génération de capsule ici : elle se lance
 * chapitre par chapitre, à la demande (`ingest-chapter`).
 */
import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { courseKeys, slideExtension } from "@/lib/ingest/keys";
import { getPresignedDownloadUrl, getPresignedPutUrl } from "@/lib/storage/r2";
import { convertToPdf, inspectPdf } from "@/lib/worker/client";
import { abortIfPermanent, errorMessage } from "./errors";

const { courses, chapters } = schema;

export const ingestCourse = schemaTask({
  id: "ingest-course",
  schema: z.object({ courseId: z.uuid() }),
  queue: { name: "ingest-course", concurrencyLimit: 5 },
  maxDuration: 900,
  run: async ({ courseId }) => {
    const db = getDb();
    const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
    if (!course) throw new AbortTaskRunError(`Cours introuvable : ${courseId}`);

    const existing = await db.query.chapters.findMany({
      where: eq(chapters.courseId, courseId),
      columns: { id: true },
    });
    if (course.status === "ready" && existing.length > 0) {
      logger.info("Cours déjà ingéré : rien à faire", { courseId, chapters: existing.length });
      return { courseId, alreadyIngested: true as const, chapters: existing.length };
    }

    // 1. Diaporama → PDF (Gemini réduirait un PPTX à son texte).
    let pdfKey = course.pdfR2Key ?? course.sourceR2Key;
    const ext = slideExtension(course.sourceR2Key);
    if (ext && !course.pdfR2Key) {
      pdfKey = courseKeys.convertedPdf(courseId);
      const converted = await abortIfPermanent(async () =>
        convertToPdf(
          await getPresignedDownloadUrl(course.sourceR2Key),
          await getPresignedPutUrl({ key: pdfKey, contentType: "application/pdf" }),
          ext,
        ),
      );
      await db.update(courses).set({ pdfR2Key: pdfKey }).where(eq(courses.id, courseId));
      logger.info("Diaporama converti en PDF", { pdfKey, ...converted });
    }

    // 2. Chapitres + lots de 25–30 pages (< 40 Mo) mesurés par le worker.
    const info = await abortIfPermanent(async () => inspectPdf(await getPresignedDownloadUrl(pdfKey)));
    logger.info("Structure détectée", {
      pages: info.page_count,
      megabytes: Math.round(info.bytes / 1e5) / 10,
      source: info.structure_source,
      chapters: info.chapters.length,
      textPagesRatio: info.text_pages_ratio,
    });

    // 3. Remplacement atomique des chapitres (relance idempotente).
    await db.batch([
      db.delete(chapters).where(eq(chapters.courseId, courseId)),
      db.insert(chapters).values(
        info.chapters.map((c, i) => ({
          courseId,
          title: c.title,
          orderIndex: i,
          pageStart: c.page_start,
          pageEnd: c.page_end,
          batches: c.batches.map((b) => ({
            pageStart: b.page_start,
            pageEnd: b.page_end,
            bytes: b.bytes,
            wholeDocument: b.whole_document,
          })),
        })),
      ),
      db
        .update(courses)
        .set({
          pdfR2Key: pdfKey,
          pageCount: info.page_count,
          structureSource: info.structure_source,
          status: "ready",
          error: null,
        })
        .where(eq(courses.id, courseId)),
    ]);

    return {
      courseId,
      pageCount: info.page_count,
      structureSource: info.structure_source,
      chapters: info.chapters.map((c) => ({ title: c.title, pages: c.pages, batches: c.batches.length })),
    };
  },
  onFailure: async ({ payload, error }) => {
    await getDb()
      .update(courses)
      .set({ status: "failed", error: errorMessage(error) })
      .where(eq(courses.id, payload.courseId));
  },
});
