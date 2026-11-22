/**
 * Détection des schémas d'un lot de pages (boîtes 0..1000), avant découpe par
 * gcp-worker `/crop-bboxes`.
 *
 * - `gemini` (défaut, validé en S.2) : Gemini Vision sur le PDF du lot.
 * - `mistral` (repli si les seuils de S.2 échouent) : Mistral OCR avec
 *   annotation des boîtes. Non testé en phase S : à valider avant usage.
 *
 * Les numéros de page sont relatifs au PDF du lot (1 = sa première page).
 */
import "server-only";
import { z } from "zod";
import { filePart, generateStructured, type GeminiFileRef } from "@/lib/ai/gemini";
import { getDb, schema } from "@/lib/db";

export interface DetectedFigure {
  /** Page dans le PDF du lot (1-indexée). */
  page: number;
  /** [ymin, xmin, ymax, xmax] normalisés 0..1000. */
  box2d: number[];
  caption: string;
  description: string;
}

export interface DetectionResult {
  figures: DetectedFigure[];
  provider: "gemini" | "mistral";
  model: string;
  costUsd: number;
}

interface DetectionContext {
  courseId: string;
  chapterId: string;
  discipline: string;
  batchLabel: string;
}

// ---------------------------------------------------------------------------
// Gemini Vision
// ---------------------------------------------------------------------------

const GeminiFigures = z.object({
  figures: z.array(
    z.object({
      page: z.number().int().describe("Numéro de page dans CE fichier, 1 = première page"),
      box_2d: z
        .array(z.number())
        .describe("[ymin, xmin, ymax, xmax] normalisés 0..1000, flèches et légendes incluses"),
      caption: z.string().describe("Légende ou titre visible du schéma, vide si absent"),
      description: z.string().describe("Ce que montre le schéma, 1 à 2 phrases en français"),
    }),
  ),
});

/** Prompt de S.2, complété par la note de RESULTS.md sur les tableaux en image. */
export function figuresPrompt(discipline: string): string {
  return `Ce PDF est un extrait de support de cours universitaire (${discipline}).
Repère chaque schéma, figure, graphique, illustration scientifique ou tableau récapitulatif illustré
(ignore logos, filigranes, décorations, photos de l'enseignant, bandeaux, QR codes). Beaucoup de
schémas sont faits de formes vectorielles et de zones de texte superposées : la boîte doit englober
TOUT le schéma, y compris flèches, annotations et légendes autour. Coordonnées
box_2d = [ymin, xmin, ymax, xmax] sur 0..1000. « page » est le numéro de page dans CE fichier
(1 = première page du fichier).`;
}

export async function detectFiguresGemini(file: GeminiFileRef, ctx: DetectionContext): Promise<DetectionResult> {
  const res = await generateStructured(GeminiFigures, {
    task: "ingest.figures",
    // S.2 : validé avec gemini-4-hydrogen en thinking « medium » (= rôle quality).
    tier: "quality",
    contents: [filePart(file), figuresPrompt(ctx.discipline)],
    courseId: ctx.courseId,
    chapterId: ctx.chapterId,
    metadata: { batch: ctx.batchLabel },
  });
  return {
    figures: res.data.figures.map((f) => ({
      page: f.page,
      box2d: f.box_2d.map((v) => Math.round(v)),
      caption: f.caption.trim(),
      description: f.description.trim(),
    })),
    provider: "gemini",
    model: res.model,
    costUsd: res.costUsd,
  };
}

// ---------------------------------------------------------------------------
// Mistral OCR (repli)
// ---------------------------------------------------------------------------

const MISTRAL_MODEL = "mistral-ocr-latest";
/** Tarif annoté (bbox_annotation), USD par page — cf. document d'architecture. */
const MISTRAL_ANNOTATED_USD_PER_PAGE = 0.005;

const MistralOcrResponse = z.object({
  pages: z.array(
    z.object({
      index: z.number().int(),
      dimensions: z.object({ width: z.number(), height: z.number() }).loose(),
      images: z
        .array(
          z
            .object({
              top_left_x: z.number(),
              top_left_y: z.number(),
              bottom_right_x: z.number(),
              bottom_right_y: z.number(),
              image_annotation: z.string().nullish(),
            })
            .loose(),
        )
        .default([]),
    }),
  ),
  usage_info: z.object({ pages_processed: z.number().int() }).loose().optional(),
});

const MistralAnnotation = z.object({
  caption: z.string().default(""),
  description: z.string().default(""),
  is_scientific_figure: z.boolean().default(true),
});

export async function detectFiguresMistral(
  documentUrl: string,
  apiKey: string,
  ctx: DetectionContext,
): Promise<DetectionResult> {
  const annotationSchema = z.toJSONSchema(
    z.object({
      caption: z.string().describe("Légende ou titre visible de l'image, vide si absent"),
      description: z.string().describe("Ce que montre l'image, 1 à 2 phrases en français"),
      is_scientific_figure: z
        .boolean()
        .describe("false pour un logo, une décoration, une photo de l'enseignant ou un QR code"),
    }),
  );
  const res = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      document: { type: "document_url", document_url: documentUrl },
      include_image_base64: false,
      bbox_annotation_format: {
        type: "json_schema",
        json_schema: { name: "figure", schema: annotationSchema, strict: true },
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`Mistral OCR → ${res.status} : ${(await res.text()).slice(0, 300)}`);
  const data = MistralOcrResponse.parse(await res.json());

  const figures: DetectedFigure[] = [];
  for (const page of data.pages) {
    const { width, height } = page.dimensions;
    for (const img of page.images) {
      let annotation = MistralAnnotation.parse({});
      try {
        annotation = MistralAnnotation.parse(JSON.parse(img.image_annotation ?? "{}"));
      } catch {
        /* annotation absente ou invalide : on garde l'image sans description */
      }
      if (!annotation.is_scientific_figure) continue;
      figures.push({
        page: page.index + 1,
        box2d: [
          (img.top_left_y / height) * 1000,
          (img.top_left_x / width) * 1000,
          (img.bottom_right_y / height) * 1000,
          (img.bottom_right_x / width) * 1000,
        ].map((v) => Math.round(v)),
        caption: annotation.caption.trim(),
        description: annotation.description.trim() || annotation.caption.trim() || "Schéma du cours",
      });
    }
  }

  const pages = data.usage_info?.pages_processed ?? data.pages.length;
  const costUsd = pages * MISTRAL_ANNOTATED_USD_PER_PAGE;
  try {
    await getDb().insert(schema.aiUsage).values({
      task: "ingest.figures",
      provider: "mistral",
      model: MISTRAL_MODEL,
      costUsd,
      courseId: ctx.courseId,
      chapterId: ctx.chapterId,
      metadata: { batch: ctx.batchLabel, pages },
    });
  } catch (err) {
    console.error("[ai_usage] échec de journalisation", err);
  }
  return { figures, provider: "mistral", model: MISTRAL_MODEL, costUsd };
}
