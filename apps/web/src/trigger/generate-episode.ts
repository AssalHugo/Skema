/**
 * Moteur 2 — capsule générée (phase 2), pour un concept :
 *   1. contexte : concept, texte natif de ses pages (gcp-worker /page-text),
 *      schémas du concept (images jointes) ;
 *   2. script (modèle QUALITY) : 150–210 mots annotés [affiché|prononcé],
 *      accroche < 5 s, 4 à 7 scènes, quiz à 4 choix ;
 *   3. voix-off : `toSsmlUnits()` → gcp-worker /tts (Neural2 + une mark par mot
 *      affiché) → MP3 + horodatage, repli `TTS_FALLBACK` si les seuils de S.3 échouent ;
 *   4. MP3 sur R2, `storyboard_json` assemblé, épisode `ready`.
 * Une seule capsule générée par concept : une relance réutilise la même ligne.
 */
import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/gemini";
import { getDb, schema } from "@/lib/db";
import type { ChapterBatch } from "@/lib/db/schema";
import { EpisodeScript, SCRIPT_SYSTEM, SCRIPT_WORDS, annotatedScript, scriptPrompt, scriptWordCount } from "@/lib/episodes/script";
import { HOOK_MAX_MS, buildStoryboard, type StoryboardDiagram } from "@/lib/episodes/storyboard";
import { courseKeys } from "@/lib/ingest/keys";
import { deleteObjects, getObjectBytes, getPresignedDownloadUrl, getPublicAssetUrl, uploadBufferToR2 } from "@/lib/storage/r2";
import { synthesizeWithFallback } from "@/lib/tts/adapter";
import { findUnannotatedTerms } from "@/lib/tts/ssml";
import { pageText } from "@/lib/worker/client";
import { errorMessage } from "./errors";

const { episodes, concepts, chapters, courses, courseDiagrams } = schema;

/** Schémas joints au prompt (images WebP < 100 Ko chacune). */
const MAX_DIAGRAMS = 6;
/** Texte natif envoyé à Gemini : quelques pages, tronquées. */
const MAX_SOURCE_PAGES = 6;
const MAX_CHARS_PER_PAGE = 3000;

const generatedEpisode = sql`engine_type = 'generated'`;

export const generateEpisode = schemaTask({
  id: "generate-episode",
  schema: z.object({
    conceptId: z.uuid(),
    /** Régénère une capsule déjà prête. */
    force: z.boolean().optional(),
  }),
  queue: { name: "generate-episode", concurrencyLimit: 5 },
  maxDuration: 600,
  // Chaque essai refait Gemini + TTS : un seul nouvel essai.
  retry: { maxAttempts: 2 },
  run: async ({ conceptId, force }) => {
    const db = getDb();
    const [row] = await db
      .select({ concept: concepts, chapter: chapters, course: courses })
      .from(concepts)
      .innerJoin(courses, eq(concepts.courseId, courses.id))
      .leftJoin(chapters, eq(concepts.chapterId, chapters.id))
      .where(eq(concepts.id, conceptId));
    if (!row) throw new AbortTaskRunError(`Concept introuvable : ${conceptId}`);
    const { concept, chapter, course } = row;

    const [existing] = await db
      .select({ id: episodes.id, status: episodes.status })
      .from(episodes)
      .where(and(eq(episodes.conceptId, conceptId), generatedEpisode));
    if (existing?.status === "ready" && !force) {
      logger.info("Capsule déjà prête", { episodeId: existing.id });
      return { conceptId, episodeId: existing.id, skipped: true as const };
    }

    // 0. Ligne de l'épisode (une par concept), passée en « scripting ».
    const [episode] = await db
      .insert(episodes)
      .values({
        conceptId,
        courseId: course.id,
        engineType: "generated",
        status: "scripting",
        title: concept.title,
      })
      .onConflictDoUpdate({
        target: episodes.conceptId,
        targetWhere: generatedEpisode,
        set: { status: "scripting", error: null },
      })
      .returning({ id: episodes.id, audioR2Key: episodes.audioR2Key });
    const ctx = { courseId: course.id, chapterId: concept.chapterId ?? undefined, episodeId: episode.id };

    // 1. Contexte : texte des pages et schémas.
    const sourceText = await loadSourceText(concept.sourcePages, chapter?.batches ?? []);
    const diagrams = await loadDiagrams(concept);
    const refs = new Map<string, StoryboardDiagram>(
      diagrams.map((d, i) => [`S${i + 1}`, { id: d.id, url: getPublicAssetUrl(d.r2ImageKey), width: d.width, height: d.height }]),
    );

    // 2. Script.
    const prompt = scriptPrompt({
      discipline: course.discipline ?? "biologie",
      chapterTitle: chapter?.title ?? concept.chapterTitle,
      conceptTitle: concept.title,
      summary: concept.summary,
      keywords: concept.keywords,
      sourcePages: concept.sourcePages,
      sourceText,
      diagrams: diagrams.map((d, i) => ({
        ref: `S${i + 1}`,
        pageNumber: d.pageNumber,
        caption: d.caption,
        aiDescription: d.aiDescription,
        attached: d.image !== null,
      })),
    });
    const imageParts = diagrams.flatMap((d, i) =>
      d.image
        ? [{ text: `Schéma S${i + 1} :` }, { inlineData: { mimeType: "image/webp", data: Buffer.from(d.image).toString("base64") } }]
        : [],
    );
    const script = await generateStructured(EpisodeScript, {
      task: "episode.script",
      tier: "quality",
      systemInstruction: SCRIPT_SYSTEM,
      contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
      ...ctx,
      metadata: { conceptId, diagrams: diagrams.length, sourcePages: sourceText.length },
    });
    const words = scriptWordCount(script.data.scenes);
    if (words < SCRIPT_WORDS.min || words > SCRIPT_WORDS.max) {
      logger.warn("Longueur du script hors cible", { words, target: SCRIPT_WORDS });
    }
    const fullScript = annotatedScript(script.data.scenes);
    const unannotated = findUnannotatedTerms(fullScript);
    if (unannotated.length) logger.warn("Termes non annotés (prononciation à vérifier)", { unannotated });

    // 3. Voix-off et horodatage.
    await db.update(episodes).set({ status: "tts", title: script.data.title.slice(0, 160) }).where(eq(episodes.id, episode.id));
    const tts = await synthesizeWithFallback({ annotatedText: fullScript }, { task: "episode.tts", ...ctx });
    if (tts.verdict && !tts.verdict.ok) logger.warn("Seuils de S.3 non respectés", { verdict: tts.verdict, attempts: tts.attempts });

    // 4. MP3 sur R2 (nouvelle clé à chaque génération : cache immuable), storyboard.
    const audioKey = courseKeys.episodeAudio(course.id, episode.id, crypto.randomUUID().slice(0, 8));
    const { url: audioUrl } = await uploadBufferToR2({ key: audioKey, body: tts.audioBuffer, contentType: tts.mimeType });
    const storyboard = buildStoryboard({
      script: script.data,
      diagrams: refs,
      wordTimings: tts.wordTimings,
      durationMs: tts.durationMs,
      audioUrl,
      audioMimeType: tts.mimeType,
      seed: episode.id,
    });

    const costUsd = script.costUsd + tts.costUsd;
    const metrics = {
      words,
      wordsInRange: words >= SCRIPT_WORDS.min && words <= SCRIPT_WORDS.max,
      scenes: storyboard.scenes.length,
      diagramScenes: storyboard.scenes.filter((s) => s.visualType === "diagram").length,
      diagramsOffered: diagrams.length,
      sourcePagesText: sourceText.length,
      hookEndMs: storyboard.hookEndMs,
      hookUnder5s: storyboard.hookEndMs <= HOOK_MAX_MS,
      unannotatedTerms: unannotated,
      tts: {
        provider: tts.provider,
        voice: tts.voice,
        usedFallback: tts.usedFallback,
        verdict: tts.verdict,
        attempts: tts.attempts,
        requests: tts.requests,
        billableChars: tts.billableChars,
        billableCharsWithoutMarks: tts.billableCharsWithoutMarks,
        latencyMs: tts.latencyMs,
        bytes: tts.audioBuffer.length,
      },
      costUsd: { script: script.costUsd, tts: tts.costUsd },
    };

    await db
      .update(episodes)
      .set({
        status: "ready",
        error: null,
        title: script.data.title.slice(0, 160),
        durationSec: tts.durationMs / 1000,
        audioR2Key: audioKey,
        storyboardJson: storyboard,
        quizJson: storyboard.quiz,
        modelUsed: script.model,
        ttsVoice: tts.voice,
        costUsd,
        metrics,
      })
      .where(eq(episodes.id, episode.id));

    if (episode.audioR2Key && episode.audioR2Key !== audioKey) {
      await deleteObjects([episode.audioR2Key]).catch((err) =>
        logger.warn("Ancien MP3 non supprimé", { key: episode.audioR2Key, err: errorMessage(err) }),
      );
    }

    return { conceptId, episodeId: episode.id, durationMs: tts.durationMs, costUsd, metrics };
  },
  onFailure: async ({ payload, error }) => {
    await getDb()
      .update(episodes)
      .set({ status: "failed", error: errorMessage(error) })
      .where(and(eq(episodes.conceptId, payload.conceptId), generatedEpisode));
  },
});

/**
 * Texte natif des pages du concept, lu dans les lots du chapitre (déjà sur R2).
 * Best effort : sans texte, le script s'appuie sur le résumé du concept.
 */
async function loadSourceText(sourcePages: number[], batches: ChapterBatch[]): Promise<{ page: number; text: string }[]> {
  const pages = [...new Set(sourcePages)].sort((a, b) => a - b).slice(0, MAX_SOURCE_PAGES);
  const byBatch = new Map<string, { batch: ChapterBatch; pages: number[] }>();
  for (const p of pages) {
    const batch = batches.find((b) => b.r2Key && p >= b.pageStart && p <= b.pageEnd);
    if (!batch?.r2Key) continue;
    const entry = byBatch.get(batch.r2Key) ?? { batch, pages: [] };
    entry.pages.push(p);
    byBatch.set(batch.r2Key, entry);
  }
  const out: { page: number; text: string }[] = [];
  for (const { batch, pages: abs } of byBatch.values()) {
    try {
      const res = await pageText(
        await getPresignedDownloadUrl(batch.r2Key!),
        abs.map((p) => p - batch.pageStart + 1),
        MAX_CHARS_PER_PAGE,
      );
      for (const p of res.pages) if (p.text.trim()) out.push({ page: p.page + batch.pageStart - 1, text: p.text });
    } catch (err) {
      logger.warn("Texte des pages indisponible", { batch: batch.r2Key, err: errorMessage(err) });
    }
  }
  return out.sort((a, b) => a.page - b.page);
}

/** Schémas du concept, complétés par ceux de ses pages, avec leur image (WebP). */
async function loadDiagrams(concept: typeof concepts.$inferSelect) {
  const db = getDb();
  const columns = {
    id: courseDiagrams.id,
    pageNumber: courseDiagrams.pageNumber,
    r2ImageKey: courseDiagrams.r2ImageKey,
    width: courseDiagrams.width,
    height: courseDiagrams.height,
    caption: courseDiagrams.caption,
    aiDescription: courseDiagrams.aiDescription,
  };
  const linked = concept.diagramIds.length
    ? await db.select(columns).from(courseDiagrams).where(inArray(courseDiagrams.id, concept.diagramIds))
    : [];
  const onPages =
    concept.chapterId && concept.sourcePages.length && linked.length < MAX_DIAGRAMS
      ? await db
          .select(columns)
          .from(courseDiagrams)
          .where(and(eq(courseDiagrams.chapterId, concept.chapterId), inArray(courseDiagrams.pageNumber, concept.sourcePages)))
      : [];
  const order = new Map(concept.diagramIds.map((id, i) => [id, i]));
  const chosen = [
    ...linked.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    ...onPages.filter((d) => !order.has(d.id)).sort((a, b) => a.pageNumber - b.pageNumber),
  ].slice(0, MAX_DIAGRAMS);

  return Promise.all(
    chosen.map(async (d) => {
      try {
        return { ...d, image: await getObjectBytes(d.r2ImageKey) };
      } catch (err) {
        logger.warn("Image du schéma illisible, description seule", { diagramId: d.id, err: errorMessage(err) });
        return { ...d, image: null };
      }
    }),
  );
}
