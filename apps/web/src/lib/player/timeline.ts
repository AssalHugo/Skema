/**
 * Calculs purs du lecteur Live Web Rendering (phase 3) : position dans la
 * timeline, caméra sur les schémas, état karaoké des mots. Sans dépendance
 * navigateur, testés dans `player.test.ts`.
 */
import type { CameraMotion, DisplaySegment, StoryboardScene, WordTimestamp } from "@/lib/storyboard/types";

/** Dernier élément dont `startMs` ≤ t (recherche dichotomique), ou -1. */
export function indexAt<T extends { startMs: number }>(items: readonly T[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].startMs <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Ease-in-out cubique : départ et arrivée doux pour la caméra. */
export function easeInOut(p: number): number {
  const x = clamp(p, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Progression 0..1 dans la scène (temps relatif à sa durée). */
export function sceneProgress(scene: Pick<StoryboardScene, "startMs" | "endMs">, t: number): number {
  return clamp((t - scene.startMs) / Math.max(1, scene.endMs - scene.startMs), 0, 1);
}

export interface CameraFrame {
  scale: number;
  /** Translation en % de la boîte du schéma (non zoomée). */
  translateX: number;
  translateY: number;
}

export const DEFAULT_CAMERA: CameraMotion = { fromScale: 1, toScale: 1, focusX: 50, focusY: 50 };

/**
 * Cadrage du schéma : le zoom passe de `fromScale` à `toScale` et le point
 * (focusX, focusY) glisse vers le centre de l'écran au fil de la scène.
 * À utiliser avec `transform: translate(tx%, ty%) scale(s)` et une origine au centre.
 */
export function cameraAt(cam: CameraMotion | undefined, progress: number): CameraFrame {
  const c = cam ?? DEFAULT_CAMERA;
  const k = easeInOut(progress);
  const scale = c.fromScale + (c.toScale - c.fromScale) * k;
  // Le point focal, à (f - 50) % du centre, se trouve à (f - 50) × s % après zoom ;
  // on le recentre d'une fraction k, bornée pour ne jamais découvrir les bords.
  const maxShift = ((scale - 1) / 2) * 100;
  const shift = (focus: number) => clamp((50 - focus) * scale * k, -maxShift, maxShift) + 0; // + 0 : pas de « -0 »
  return { scale, translateX: shift(c.focusX), translateY: shift(c.focusY) };
}

export type WordState = "past" | "current" | "future";

/** Mots de la ligne de sous-titres affichée à l'instant t, avec leur état karaoké. */
export function captionAt(
  segments: readonly DisplaySegment[],
  words: readonly WordTimestamp[],
  t: number,
): { segmentIndex: number; words: { word: string; state: WordState; index: number }[] } | null {
  const segmentIndex = indexAt(segments, t);
  if (segmentIndex < 0) return null;
  const seg = segments[segmentIndex];
  // Silence après la dernière ligne : on la garde affichée (pas de clignotement entre phrases).
  const current = indexAt(words, t);
  return {
    segmentIndex,
    words: words.slice(seg.startWord, seg.endWord).map((w, k) => {
      const index = seg.startWord + k;
      const state: WordState = index < current || (index === current && t >= w.endMs) ? "past" : index === current ? "current" : "future";
      return { word: w.word, state, index };
    }),
  };
}

/** Pourcentage regardé (0..100), arrondi, pour `user_progress.watched_pct`. */
export function watchedPct(maxTimeMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.round(clamp((maxTimeMs / totalMs) * 100, 0, 100));
}

export const PLAYBACK_RATES = [1, 1.25, 1.5] as const;

export function nextRate(rate: number): number {
  const i = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

/** Fenêtre de virtualisation : cartes montées autour de la carte active (3 cartes). */
export function mountedWindow(active: number, count: number, radius = 1): { from: number; to: number } {
  return { from: Math.max(0, active - radius), to: Math.min(count - 1, active + radius) };
}
