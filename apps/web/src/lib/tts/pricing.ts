/**
 * Tarifs Google Cloud TTS (page officielle, cf. plan « Corrections » point 4) :
 * palier gratuit mensuel PAR FAMILLE de voix, puis prix par million de caractères.
 * Le prix WaveNet (repli 1) est à revérifier sur la page des tarifs avant usage.
 */
export type VoiceFamily = "neural2" | "wavenet" | "standard" | "chirp3-hd" | "other";

interface TtsPrice {
  freeCharsPerMonth: number;
  usdPerMillion: number;
}

const PRICES: Record<VoiceFamily, TtsPrice> = {
  neural2: { freeCharsPerMonth: 1_000_000, usdPerMillion: 16 },
  wavenet: { freeCharsPerMonth: 4_000_000, usdPerMillion: 4 },
  standard: { freeCharsPerMonth: 4_000_000, usdPerMillion: 4 },
  "chirp3-hd": { freeCharsPerMonth: 1_000_000, usdPerMillion: 30 },
  // Voix inconnue : on compte au tarif le plus élevé, sans palier gratuit (prudent).
  other: { freeCharsPerMonth: 0, usdPerMillion: 30 },
};

export function voiceFamily(voice: string): VoiceFamily {
  const v = voice.toLowerCase();
  if (v.includes("neural2")) return "neural2";
  if (v.includes("wavenet")) return "wavenet";
  if (v.includes("standard")) return "standard";
  if (v.includes("chirp3-hd") || v.includes("chirp-hd")) return "chirp3-hd";
  return "other";
}

export function ttsPrice(voice: string): TtsPrice {
  return PRICES[voiceFamily(voice)];
}

/** Prix catalogue, sans palier gratuit. */
export function ttsListCostUsd(voice: string, chars: number): number {
  return (chars / 1e6) * ttsPrice(voice).usdPerMillion;
}

/**
 * Coût marginal d'une synthèse de `chars` caractères, sachant que
 * `monthToDateChars` ont déjà été consommés ce mois-ci par la même famille.
 */
export function ttsMarginalCostUsd(voice: string, chars: number, monthToDateChars: number): number {
  const { freeCharsPerMonth, usdPerMillion } = ttsPrice(voice);
  const freeLeft = Math.max(0, freeCharsPerMonth - monthToDateChars);
  return (Math.max(0, chars - freeLeft) / 1e6) * usdPerMillion;
}
