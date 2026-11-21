/**
 * Tarifs Gemini (USD par million de tokens, palier standard), vérifiés le
 * 13/11/2026 (`spikes/common.py`). Un modèle inconnu est compté à 0 et signalé.
 */
interface Price {
  input: number;
  output: number;
}

const PROMO_END_3_8_FLASH = Date.UTC(2027, 0, 1);

export function geminiPrice(model: string, at: Date = new Date()): Price | undefined {
  switch (model) {
    case "gemini-4-hydrogen":
      return { input: 1.5, output: 7.5 };
    case "gemini-3.8-flash":
      // Promo −50 % jusqu'au 31/12/2026 inclus.
      return at.getTime() < PROMO_END_3_8_FLASH
        ? { input: 0.75, output: 3.75 }
        : { input: 1.5, output: 7.5 };
    case "gemini-3.5-flash-lite":
      return { input: 0.3, output: 2.5 };
    default:
      return undefined;
  }
}

export interface TokenCounts {
  /** promptTokenCount + toolUsePromptTokenCount (tokens vidéo du mode agentique). */
  inputTokens: number;
  /** candidatesTokenCount + thoughtsTokenCount (la réflexion est facturée en sortie). */
  outputTokens: number;
  thinkingTokens: number;
  toolUsePromptTokens: number;
}

export function geminiCostUsd(model: string, t: TokenCounts, at?: Date): number {
  const p = geminiPrice(model, at);
  if (!p) return 0;
  return (t.inputTokens / 1e6) * p.input + (t.outputTokens / 1e6) * p.output;
}
