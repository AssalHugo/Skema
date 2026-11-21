/**
 * Adaptateur Gemini (`@google/genai`).
 *
 * - `generateStructured()` : sortie JSON validée par un schéma Zod.
 * - `thinkingLevel` toujours explicite (le défaut de l'API est `HIGH`).
 * - Chaque appel est journalisé dans `ai_usage`, en additionnant
 *   `toolUsePromptTokenCount` (tokens vidéo du mode agentique, constaté en S.1).
 */
import "server-only";
import {
  GoogleGenAI,
  ThinkingLevel,
  type ContentListUnion,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { geminiEnv } from "@/lib/env";
import { geminiCostUsd, geminiPrice, type TokenCounts } from "./pricing";

export { ThinkingLevel };

/** Rôle du modèle ; l'identifiant réel vient des variables d'environnement. */
export type ModelTier = "quality" | "bulk" | "lite";

export function resolveModel(tier: ModelTier): string {
  const env = geminiEnv();
  return {
    quality: env.GEMINI_MODEL_QUALITY,
    bulk: env.GEMINI_MODEL_BULK,
    lite: env.GEMINI_MODEL_LITE,
  }[tier];
}

/** Niveau de réflexion par défaut de chaque rôle (cf. plan, section 0). */
const DEFAULT_THINKING: Record<ModelTier, ThinkingLevel> = {
  quality: ThinkingLevel.MEDIUM,
  bulk: ThinkingLevel.LOW,
  lite: ThinkingLevel.MINIMAL,
};

const clients = new Map<string, GoogleGenAI>();

/**
 * Client par version d'API. Le mode vidéo agentique exige `v1beta` (S.1).
 */
export function getGemini(apiVersion: "v1" | "v1beta" = "v1beta"): GoogleGenAI {
  let c = clients.get(apiVersion);
  if (!c) {
    c = new GoogleGenAI({ apiKey: geminiEnv().GEMINI_API_KEY, apiVersion });
    clients.set(apiVersion, c);
  }
  return c;
}

export function tokenCounts(usage: GenerateContentResponseUsageMetadata | undefined): TokenCounts {
  const toolUse = usage?.toolUsePromptTokenCount ?? 0;
  const thinking = usage?.thoughtsTokenCount ?? 0;
  return {
    inputTokens: (usage?.promptTokenCount ?? 0) + toolUse,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + thinking,
    thinkingTokens: thinking,
    toolUsePromptTokens: toolUse,
  };
}

export interface UsageContext {
  /** Nom de la tâche pour `ai_usage.task`, ex. "ingest.concepts". */
  task: string;
  courseId?: string;
  episodeId?: string;
  metadata?: Record<string, unknown>;
}

/** Enregistre une ligne `ai_usage`. Ne fait jamais échouer l'appel métier. */
export async function logGeminiUsage(
  model: string,
  usage: GenerateContentResponseUsageMetadata | undefined,
  ctx: UsageContext,
): Promise<{ costUsd: number; tokens: TokenCounts }> {
  const tokens = tokenCounts(usage);
  const costUsd = geminiCostUsd(model, tokens);
  if (!geminiPrice(model)) {
    console.warn(`[ai_usage] tarif inconnu pour ${model} : coût compté à 0`);
  }
  try {
    await getDb().insert(schema.aiUsage).values({
      task: ctx.task,
      provider: "gemini",
      model,
      ...tokens,
      costUsd,
      courseId: ctx.courseId,
      episodeId: ctx.episodeId,
      metadata: { ...ctx.metadata, totalTokenCount: usage?.totalTokenCount },
    });
  } catch (err) {
    console.error("[ai_usage] échec de journalisation", err);
  }
  return { costUsd, tokens };
}

export interface GenerateStructuredOptions extends UsageContext {
  contents: ContentListUnion;
  tier?: ModelTier;
  /** Remplace le modèle du `tier` (ex. tests A/B). */
  model?: string;
  systemInstruction?: string;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  apiVersion?: "v1" | "v1beta";
  /** Nouvel essai si la sortie ne respecte pas le schéma (défaut : 1). */
  retries?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  costUsd: number;
  tokens: TokenCounts;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string | undefined,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "StructuredOutputError";
  }
}

/**
 * Génère une sortie JSON conforme à `zodSchema`.
 * Le schéma est transmis à Gemini (`responseJsonSchema`) puis revalidé côté
 * serveur : on ne fait jamais confiance au modèle pour respecter le contrat.
 */
export async function generateStructured<S extends z.ZodType>(
  zodSchema: S,
  opts: GenerateStructuredOptions,
): Promise<StructuredResult<z.infer<S>>> {
  const tier = opts.tier ?? "quality";
  const model = opts.model ?? resolveModel(tier);
  const thinkingLevel = opts.thinkingLevel ?? DEFAULT_THINKING[tier];
  const jsonSchema = z.toJSONSchema(zodSchema, { target: "draft-2020-12" });
  const ai = getGemini(opts.apiVersion);

  let totalCost = 0;
  const totalTokens: TokenCounts = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    toolUsePromptTokens: 0,
  };
  let lastError: unknown;
  let lastRaw: string | undefined;
  const attempts = 1 + Math.max(0, opts.retries ?? 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await ai.models.generateContent({
      model,
      contents: opts.contents,
      config: {
        systemInstruction: opts.systemInstruction,
        temperature: opts.temperature,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        thinkingConfig: { thinkingLevel },
      },
    });

    const { costUsd, tokens } = await logGeminiUsage(model, response.usageMetadata, {
      task: opts.task,
      courseId: opts.courseId,
      episodeId: opts.episodeId,
      metadata: { ...opts.metadata, attempt, thinkingLevel },
    });
    totalCost += costUsd;
    totalTokens.inputTokens += tokens.inputTokens;
    totalTokens.outputTokens += tokens.outputTokens;
    totalTokens.thinkingTokens += tokens.thinkingTokens;
    totalTokens.toolUsePromptTokens += tokens.toolUsePromptTokens;
    lastRaw = response.text;

    try {
      const parsed = zodSchema.parse(JSON.parse(lastRaw ?? ""));
      return { data: parsed, model, costUsd: totalCost, tokens: totalTokens };
    } catch (err) {
      lastError = err;
    }
  }

  throw new StructuredOutputError(
    `Sortie Gemini non conforme au schéma après ${attempts} essai(s) (${opts.task}, ${model}, coût ${totalCost.toFixed(4)} $, tokens ${JSON.stringify(totalTokens)})`,
    lastRaw,
    lastError,
  );
}
