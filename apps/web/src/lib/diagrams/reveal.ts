/**
 * Instants d'apparition des éléments d'un schéma généré, calculés côté serveur
 * à partir de l'horodatage de la voix-off (jamais laissés au LLM) :
 * - un nœud apparaît quand son libellé est prononcé dans l'une des scènes qui
 *   montrent le schéma (première occurrence) ;
 * - repli déterministe sinon : répartition uniforme sur la première scène du
 *   schéma, dans l'ordre des `nodes`, monotone par rapport aux nœuds placés ;
 * - un lien apparaît avec le dernier de ses deux nœuds.
 * Module pur.
 */
import type { DiagramSpec, GeneratedDiagram, WordTimestamp } from "@/lib/storyboard/types";
import { displayText } from "@/lib/tts/ssml";
import { edgeKey } from "./text";

/** L'élément apparaît un peu avant le mot (le temps que l'œil le trouve). */
export const REVEAL_LEAD_MS = 150;

export interface RevealScene {
  startMs: number;
  endMs: number;
  /** Mots de la scène dans `wordTimings` : [startWord, endWord[. */
  startWord: number;
  endWord: number;
}

/** Forme comparable d'un mot : minuscules, sans accents, élision ni ponctuation. */
export function normalizeToken(word: string): string {
  return displayText(word)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/^(?:[ldjmnst]|qu|jusqu|lorsqu|puisqu)'/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function labelTokens(label: string): string[] {
  return displayText(label)
    .split(/[\s\-–—/]+/u)
    .map(normalizeToken)
    .filter(Boolean);
}

/** Égalité tolérante au pluriel (-s, -x). */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 3 && l.length === s.length + 1 && l.startsWith(s) && /[sx]$/.test(l);
}

/** Index du premier mot où la suite `tokens` commence, dans [from, to[, ou -1. */
export function findTokens(words: readonly string[], tokens: readonly string[], from: number, to: number): number {
  if (!tokens.length) return -1;
  for (let i = from; i + tokens.length <= to; i++) {
    let k = 0;
    while (k < tokens.length && sameToken(words[i + k], tokens[k])) k++;
    if (k === tokens.length) return i;
  }
  return -1;
}

/**
 * `scenes` : les scènes qui montrent ce schéma, dans l'ordre de la capsule
 * (au moins une). Renvoie les instants (ms) de chaque nœud et de chaque lien.
 */
export function computeReveal(
  spec: DiagramSpec,
  scenes: readonly RevealScene[],
  wordTimings: readonly WordTimestamp[],
): GeneratedDiagram["reveal"] {
  const first = scenes[0];
  if (!first) throw new Error("computeReveal : aucune scène ne montre ce schéma");
  // Sous-mots du dernier mot fléché (« ATP-synthase ») : un mot affiché peut en porter plusieurs.
  const flat: { token: string; word: number }[] = [];
  wordTimings.forEach((w, i) => {
    for (const t of labelTokens(w.word)) flat.push({ token: t, word: i });
  });
  const tokens = flat.map((f) => f.token);

  const found: (number | null)[] = spec.nodes.map((n) => {
    const want = labelTokens(n.label);
    for (const s of scenes) {
      const from = flat.findIndex((f) => f.word >= s.startWord);
      if (from < 0) continue;
      let to = flat.findIndex((f) => f.word >= s.endWord);
      if (to < 0) to = flat.length;
      const at = findTokens(tokens, want, from, to);
      if (at >= 0) return Math.max(s.startMs, wordTimings[flat[at].word].startMs - REVEAL_LEAD_MS);
    }
    return null;
  });

  // Repli : les nœuds non retrouvés sont répartis uniformément sur la première scène,
  // bornés par les nœuds voisins déjà placés pour rester dans l'ordre de `nodes`.
  const missing = found.flatMap((t, i) => (t === null ? [i] : []));
  const span = Math.max(0, first.endMs - first.startMs);
  const times = [...found];
  missing.forEach((i, k) => {
    let t = first.startMs + (span * k) / missing.length;
    const lower = Math.max(first.startMs, ...times.slice(0, i).filter((x): x is number => x !== null));
    const nextPlaced = found.slice(i + 1).find((x): x is number => x !== null);
    t = Math.max(t, lower);
    if (nextPlaced !== undefined && nextPlaced >= lower) t = Math.min(t, nextPlaced);
    times[i] = Math.round(t);
  });

  const nodes: Record<string, number> = {};
  spec.nodes.forEach((n, i) => (nodes[n.id] = Math.round(times[i]!)));
  const edges: Record<string, number> = {};
  for (const e of spec.edges) edges[edgeKey(e.from, e.to)] = Math.max(nodes[e.from] ?? 0, nodes[e.to] ?? 0);
  return { nodes, edges };
}
