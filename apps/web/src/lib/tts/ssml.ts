/**
 * Texte annoté `[affiché|prononcé]` → SSML Google (`<sub alias>`), avec une
 * unité par mot AFFICHÉ : les timepoints des `<mark>` tombent directement sur
 * les mots des sous-titres (plus besoin de `mapSpokenTimingsToDisplayWords()`).
 *
 * Règles mesurées en S.3 (`spikes/s3_tts_align.py`) sur Neural2 :
 *  - ponctuation HORS de l'alias (sinon l'alias est épelé lettre par lettre) ;
 *  - élision « l' » DANS l'alias (sinon la voix dit « l apostrophe »).
 *
 * Module pur (sans dépendance serveur) : testé dans `ssml.test.ts`.
 */

/** Un mot affiché et son fragment SSML (sans mark). */
export interface SsmlUnit {
  word: string;
  ssml: string;
}

const TOKEN_RE = /(?:\[[^\]]*\]|\S)+/gu;
/** Groupe annoté, avec l'élision éventuellement collée devant (l', d', qu'…). */
const GROUP_RE = /([\p{L}]+['’])?\[([^|\]]*)\|([^\]]*)\]/gu;

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeXml(text).replace(/"/g, "&quot;");
}

/** Crochets ou barres orphelins (annotation mal formée) : retirés. */
function clean(text: string): string {
  return text.replace(/[[\]|]/g, "");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Découpe le texte annoté en mots affichés + fragments SSML. */
export function toSsmlUnits(annotated: string): SsmlUnit[] {
  const units: SsmlUnit[] = [];
  for (const [token] of annotated.normalize("NFC").matchAll(TOKEN_RE)) {
    let word = "";
    let ssml = "";
    let last = 0;
    for (const m of token.matchAll(GROUP_RE)) {
      const before = clean(token.slice(last, m.index));
      const prefix = m[1] ?? "";
      const display = squash(clean(m[2]));
      const spoken = squash(clean(m[3])) || display;
      word += before + prefix + display;
      ssml += escapeXml(before);
      if (display) ssml += `<sub alias="${escapeAttr(prefix + spoken)}">${escapeXml(prefix + display)}</sub>`;
      else ssml += escapeXml(prefix);
      last = m.index + m[0].length;
    }
    const after = clean(token.slice(last));
    word += after;
    ssml += escapeXml(after);
    if (word.trim()) units.push({ word, ssml });
  }
  return units;
}

/** Document SSML complet, avec une `<mark name="i"/>` tous les `markEvery` mots (0 : aucune). */
export function toSsml(annotatedOrUnits: string | SsmlUnit[], markEvery = 1): string {
  const units = typeof annotatedOrUnits === "string" ? toSsmlUnits(annotatedOrUnits) : annotatedOrUnits;
  const body = units
    .map((u, i) => (markEvery > 0 && i % markEvery === 0 ? `<mark name="${i}"/>` : "") + u.ssml)
    .join(" ");
  return `<speak>${body}</speak>`;
}

/** Texte affiché (sous-titres) d'un texte annoté. */
export function displayText(annotated: string): string {
  return toSsmlUnits(annotated)
    .map((u) => u.word)
    .join(" ");
}

/** Texte prononcé (aliases substitués) d'un texte annoté. */
export function spokenText(annotated: string): string {
  return squash(
    annotated.normalize("NFC").replace(GROUP_RE, (_all, prefix: string | undefined, d: string, s: string) => {
      return (prefix ?? "") + (squash(clean(s)) || squash(clean(d)));
    }),
  );
}

/** Nombre de mots affichés (un groupe `[37 °C|…]` compte pour un mot). */
export function countWords(annotated: string): number {
  return toSsmlUnits(annotated).length;
}

const SUSPICIOUS_RE = /[\d°%‰⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺₀₁₂₃₄₅₆₇₈₉µ/=]|\p{Lu}[\p{Lu}\d]|\p{Ll}\p{Lu}/u;

/**
 * Termes hors annotation qui risquent d'être mal prononcés : chiffres, unités,
 * exposants, sigles (≥ 2 majuscules ou « pH »). Le prompt impose de les annoter.
 */
export function findUnannotatedTerms(annotated: string): string[] {
  const outside = annotated.normalize("NFC").replace(GROUP_RE, " ");
  const terms = new Set<string>();
  for (const [token] of outside.matchAll(TOKEN_RE)) {
    const word = clean(token).replace(/^[(«"“]+|[.,;:!?…»”")]+$/gu, "");
    if (word && SUSPICIOUS_RE.test(word)) terms.add(word);
  }
  return [...terms];
}
