/**
 * Adaptateur TTS : `TTSProvider → { audioBuffer, mimeType, durationMs, wordTimings }`.
 *
 * - `GoogleNeural2Provider` (défaut, validé en S.3) et `GoogleWavenetProvider`
 *   (repli 1) appellent gcp-worker `/tts` : l'authentification Google (compte de
 *   service attaché, ADC) reste dans Cloud Run.
 * - `ScribeAlignedProvider` (repli 2) et `ElevenLabsV4TurboProvider` (premium)
 *   sont désactivés : S.3 n'a pas justifié leur réintroduction.
 * - `synthesizeWithFallback()` bascule sur `TTS_FALLBACK` si la synthèse
 *   principale échoue ou rate les seuils de S.3 (couverture des marks,
 *   monotonie, mots < 50 ms), puis journalise les caractères dans `ai_usage`.
 */
import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ttsEnv } from "@/lib/env";
import type { WordTimestamp } from "@/lib/storyboard/types";
import { synthesizeSpeech, WorkerError, type TtsResult } from "@/lib/worker/client";
import { ttsListCostUsd, ttsMarginalCostUsd, voiceFamily } from "./pricing";
import { toSsmlUnits, type SsmlUnit } from "./ssml";

export interface TTSRequest {
  /** Texte annoté `[affiché|prononcé]` (cf. `toSsmlUnits()`). */
  annotatedText: string;
  speakingRate?: number;
}

export interface TTSVerdict {
  ok: boolean;
  fails: string[];
  markCoveragePct: number;
  monotonic: boolean;
  wordsUnder50ms: number;
}

export interface TTSResult {
  audioBuffer: Buffer;
  mimeType: string;
  durationMs: number;
  /** Un horodatage par mot AFFICHÉ, dans l'ordre de `toSsmlUnits()`. */
  wordTimings: WordTimestamp[];
  provider: string;
  voice: string;
  /** Caractères facturables estimés (SSML envoyé, marks comprises). */
  billableChars: number;
  billableCharsWithoutMarks: number;
  requests: number;
  latencyMs: number;
  verdict: TTSVerdict | null;
}

export interface TTSProvider {
  readonly id: string;
  readonly voice: string;
  synthesize(req: TTSRequest): Promise<TTSResult>;
}

export class TTSProviderDisabledError extends Error {
  constructor(provider: string, reason: string) {
    super(`Fournisseur TTS ${provider} désactivé : ${reason}`);
    this.name = "TTSProviderDisabledError";
  }
}

/** Horodatage renvoyé pour un autre nombre de mots que ceux envoyés. */
export class TTSAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TTSAlignmentError";
  }
}

// ---------------------------------------------------------------------------
// Google Cloud TTS (via gcp-worker /tts)
// ---------------------------------------------------------------------------

abstract class GoogleCloudTtsProvider implements TTSProvider {
  abstract readonly id: string;

  constructor(
    readonly voice: string,
    private readonly markEvery: number,
    private readonly mp3Kbps: number,
  ) {}

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const units = toSsmlUnits(req.annotatedText);
    if (!units.length) throw new Error("Texte à synthétiser vide");
    const res = await synthesizeSpeech({
      units,
      voice: this.voice,
      markEvery: this.markEvery,
      speakingRate: req.speakingRate,
      mp3Kbps: this.mp3Kbps,
    });
    return toResult(this.id, units, res);
  }
}

export class GoogleNeural2Provider extends GoogleCloudTtsProvider {
  readonly id = "google-neural2";
}

export class GoogleWavenetProvider extends GoogleCloudTtsProvider {
  readonly id = "google-wavenet";
}

function toResult(provider: string, units: SsmlUnit[], res: TtsResult): TTSResult {
  if (res.word_timings.length !== units.length) {
    throw new TTSAlignmentError(`${res.word_timings.length} horodatages pour ${units.length} mots`);
  }
  return {
    audioBuffer: Buffer.from(res.audio_base64, "base64"),
    mimeType: res.mime_type,
    durationMs: res.duration_ms,
    wordTimings: res.word_timings.map((w, i) => ({ word: units[i].word, startMs: w.start_ms, endMs: w.end_ms })),
    provider,
    voice: res.voice,
    billableChars: res.billable_chars,
    billableCharsWithoutMarks: res.billable_chars_without_marks,
    requests: res.requests,
    latencyMs: res.latency_ms,
    verdict: res.verdict && {
      ok: res.verdict.ok,
      fails: res.verdict.fails,
      markCoveragePct: res.verdict.mark_coverage_pct,
      monotonic: res.verdict.monotonic,
      wordsUnder50ms: res.verdict.words_under_50ms,
    },
  };
}

// ---------------------------------------------------------------------------
// Replis désactivés
// ---------------------------------------------------------------------------

/** Repli 2 : Neural2 sans marks + alignement ElevenLabs Scribe. Non réintroduit (S.3 ✅). */
export class ScribeAlignedProvider implements TTSProvider {
  readonly id = "scribe-aligned";
  constructor(readonly voice: string) {}
  async synthesize(): Promise<TTSResult> {
    throw new TTSProviderDisabledError(
      this.id,
      "S.3 a validé Neural2 + <mark> ; à implémenter seulement si ses seuils échouent sur 2 essais",
    );
  }
}

/** Premium : ElevenLabs eleven_v4_turbo. Désactivé (coût). */
export class ElevenLabsV4TurboProvider implements TTSProvider {
  readonly id = "elevenlabs-v4-turbo";
  readonly voice = "eleven_v4_turbo";
  async synthesize(): Promise<TTSResult> {
    throw new TTSProviderDisabledError(this.id, "profil premium non activé");
  }
}

// ---------------------------------------------------------------------------
// Sélection et repli
// ---------------------------------------------------------------------------

/** Voix WaveNet de même lettre (fr-FR-Neural2-F → fr-FR-Wavenet-F). */
export function wavenetVoiceFor(voice: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2})-[\w]+-([A-Z])$/.exec(voice);
  return m ? `${m[1]}-Wavenet-${m[2]}` : "fr-FR-Wavenet-F";
}

export function getTTSProvider(): TTSProvider {
  const env = ttsEnv();
  return new GoogleNeural2Provider(env.TTS_VOICE, env.TTS_MARK_EVERY, env.TTS_MP3_KBPS);
}

export function getFallbackProvider(): TTSProvider | null {
  const env = ttsEnv();
  switch (env.TTS_FALLBACK) {
    case "wavenet":
      return new GoogleWavenetProvider(
        env.TTS_FALLBACK_VOICE ?? wavenetVoiceFor(env.TTS_VOICE),
        env.TTS_MARK_EVERY,
        env.TTS_MP3_KBPS,
      );
    case "scribe":
      return new ScribeAlignedProvider(env.TTS_VOICE);
    default:
      return null;
  }
}

export interface TTSUsageContext {
  task: string;
  courseId?: string;
  chapterId?: string;
  episodeId?: string;
}

export interface TTSOutcome extends TTSResult {
  costUsd: number;
  /** Tentatives (fournisseur, raison de l'échec) avant le résultat retenu. */
  attempts: { provider: string; voice: string; error?: string; verdict?: TTSVerdict | null }[];
  usedFallback: boolean;
}

/**
 * Synthèse par le fournisseur principal, puis par le repli si l'appel échoue
 * (hors erreur définitive) ou si les seuils de S.3 ne sont pas respectés.
 * Sans repli configuré, un verdict négatif est conservé (signalé dans les métriques).
 */
export async function synthesizeWithFallback(req: TTSRequest, ctx: TTSUsageContext): Promise<TTSOutcome> {
  const providers = [getTTSProvider(), getFallbackProvider()].filter((p): p is TTSProvider => p !== null);
  const attempts: TTSOutcome["attempts"] = [];
  const rejected: { result: TTSResult; index: number }[] = [];
  let costUsd = 0;
  let firstError: unknown;

  for (const [index, provider] of providers.entries()) {
    try {
      const result = await provider.synthesize(req);
      costUsd += await logTtsUsage(result, ctx);
      attempts.push({ provider: provider.id, voice: provider.voice, verdict: result.verdict });
      if (result.verdict?.ok !== false) return { ...result, costUsd, attempts, usedFallback: index > 0 };
      console.warn(`[tts] seuils de S.3 non respectés (${provider.id}) : ${result.verdict.fails.join(", ")}`);
      rejected.push({ result, index });
    } catch (err) {
      firstError ??= err;
      attempts.push({ provider: provider.id, voice: provider.voice, error: err instanceof Error ? err.message : String(err) });
      // Erreur définitive (SSML refusé, secret invalide…) : le repli recevrait la même requête.
      if (err instanceof WorkerError && err.isPermanent) throw err;
    }
  }
  // Aucun verdict positif : on garde le résultat qui rate le moins de critères (signalé dans les métriques).
  if (rejected.length) {
    const best = rejected.reduce((a, b) => (failCount(b.result) < failCount(a.result) ? b : a));
    return { ...best.result, costUsd, attempts, usedFallback: best.index > 0 };
  }
  throw firstError;
}

function failCount(r: TTSResult): number {
  return r.verdict?.fails.length ?? 0;
}

/** Ligne `ai_usage` (provider google-tts). Ne fait jamais échouer la synthèse. */
async function logTtsUsage(result: TTSResult, ctx: TTSUsageContext): Promise<number> {
  const family = voiceFamily(result.voice);
  // Prudent : prix catalogue si la consommation du mois ne peut pas être lue.
  let costUsd = ttsListCostUsd(result.voice, result.billableChars);
  try {
    const db = getDb();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [row] = await db
      .select({ chars: sql<number>`coalesce(sum(${schema.aiUsage.characters}), 0)::int` })
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.provider, "google-tts"),
          gte(schema.aiUsage.createdAt, monthStart),
          sql`${schema.aiUsage.metadata}->>'family' = ${family}`,
        ),
      );
    const monthToDate = Number(row?.chars ?? 0);
    costUsd = ttsMarginalCostUsd(result.voice, result.billableChars, monthToDate);
    await db.insert(schema.aiUsage).values({
      task: ctx.task,
      provider: "google-tts",
      model: result.voice,
      characters: result.billableChars,
      costUsd,
      courseId: ctx.courseId,
      chapterId: ctx.chapterId,
      episodeId: ctx.episodeId,
      metadata: {
        family,
        ttsProvider: result.provider,
        charsWithoutMarks: result.billableCharsWithoutMarks,
        listCostUsd: ttsListCostUsd(result.voice, result.billableChars),
        monthToDateChars: monthToDate,
        requests: result.requests,
        durationMs: result.durationMs,
        verdict: result.verdict,
      },
    });
  } catch (err) {
    console.error("[ai_usage] échec de journalisation TTS", err);
  }
  return costUsd;
}
