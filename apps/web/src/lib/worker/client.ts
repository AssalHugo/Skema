/**
 * Client du micro-service Cloud Run `gcp-worker` (en-tête X-Worker-Secret).
 * Les réponses sont validées par Zod : un contrat cassé échoue tôt et
 * clairement plutôt que d'écrire des données incohérentes en base.
 */
import "server-only";
import { z } from "zod";
import { workerEnv } from "@/lib/env";

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }

  /** 4xx : la requête est en cause (PDF corrompu, protégé…), réessayer est inutile. */
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

async function callWorker<S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  timeoutMs = 600_000,
): Promise<z.infer<S>> {
  const env = workerEnv();
  const url = new URL(path, env.GCP_WORKER_URL).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Secret": env.GCP_WORKER_SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.stringify((JSON.parse(detail) as { detail?: unknown }).detail ?? detail);
    } catch {
      /* corps non JSON */
    }
    throw new WorkerError(`gcp-worker ${path} → ${res.status} : ${detail.slice(0, 500)}`, res.status, path);
  }
  return schema.parse(await res.json());
}

// ---------------------------------------------------------------------------
// POST /split-and-inspect
// ---------------------------------------------------------------------------

const WorkerBatch = z.object({
  page_start: z.number().int(),
  page_end: z.number().int(),
  bytes: z.number().int().nullable(),
  whole_document: z.boolean(),
});

const InspectResult = z.object({
  bytes: z.number().int(),
  page_count: z.number().int().positive(),
  title: z.string().nullable(),
  structure_source: z.enum(["outline", "headings", "fixed", "single"]),
  needs_split: z.boolean(),
  text_pages_ratio: z.number(),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        page_start: z.number().int(),
        page_end: z.number().int(),
        pages: z.number().int(),
        batches: z.array(WorkerBatch).min(1),
      }),
    )
    .min(1),
});
export type InspectResult = z.infer<typeof InspectResult>;

export function inspectPdf(sourceUrl: string): Promise<InspectResult> {
  return callWorker("/split-and-inspect", { source_url: sourceUrl }, InspectResult);
}

const SplitResult = z.object({
  page_count: z.number().int(),
  uploads: z.array(z.object({ page_start: z.number().int(), page_end: z.number().int(), bytes: z.number().int() })),
});

export function splitPdf(
  sourceUrl: string,
  uploads: { pageStart: number; pageEnd: number; putUrl: string }[],
): Promise<z.infer<typeof SplitResult>> {
  return callWorker(
    "/split-and-inspect",
    {
      source_url: sourceUrl,
      uploads: uploads.map((u) => ({ page_start: u.pageStart, page_end: u.pageEnd, put_url: u.putUrl })),
    },
    SplitResult,
  );
}

// ---------------------------------------------------------------------------
// POST /crop-bboxes
// ---------------------------------------------------------------------------

const CropResult = z.object({
  page_count: z.number().int(),
  crops: z.array(
    z.object({
      index: z.number().int(),
      page: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
      bytes: z.number().int(),
      quality: z.number().int(),
      clip: z.array(z.number()),
      cut_text: z.array(z.string()),
      webp_base64: z.string(),
    }),
  ),
  invalid: z.array(z.object({ index: z.number().int(), reason: z.string() })),
  metrics: z.object({
    figures: z.number().int(),
    cropped: z.number().int(),
    invalid_box_ratio: z.number(),
    cut_text_ratio: z.number(),
    avg_kb: z.number(),
    verdict: z.object({ ok: z.boolean(), fails: z.array(z.string()) }).loose(),
  }),
});
export type CropResult = z.infer<typeof CropResult>;

export function cropBboxes(
  sourceUrl: string,
  figures: { page: number; box2d: number[] }[],
  opts: { margin?: number; dpi?: number; maxBytes?: number } = {},
): Promise<CropResult> {
  return callWorker(
    "/crop-bboxes",
    {
      source_url: sourceUrl,
      figures: figures.map((f) => ({ page: f.page, box_2d: f.box2d })),
      margin: opts.margin ?? 0.04,
      dpi: opts.dpi ?? 200,
      max_bytes: opts.maxBytes ?? 100_000,
    },
    CropResult,
  );
}

// ---------------------------------------------------------------------------
// POST /pptx-to-pdf
// ---------------------------------------------------------------------------

const ConvertResult = z.object({ page_count: z.number().int(), bytes: z.number().int() });

export function convertToPdf(
  sourceUrl: string,
  putUrl: string,
  extension: "pptx" | "ppt" | "odp",
): Promise<z.infer<typeof ConvertResult>> {
  return callWorker("/pptx-to-pdf", { source_url: sourceUrl, put_url: putUrl, extension }, ConvertResult);
}
