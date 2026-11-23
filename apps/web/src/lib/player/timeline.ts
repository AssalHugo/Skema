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

/** Part du panneau occupée par le schéma (object-contain), sur chaque axe, 0..1. */
export interface ContentBox {
  cw: number;
  ch: number;
}

const FULL_BOX: ContentBox = { cw: 1, ch: 1 };

/** Ratio largeur/hauteur du panneau : au plus carré, pour qu'un schéma paysage garde de la hauteur. */
export function diagramPanelRatio(width?: number, height?: number): number {
  if (!width || !height) return 1;
  return clamp(width / height, 0.75, 1);
}

/** Boîte du schéma dans son panneau (les bandes blanches de part et d'autre ne sont pas du contenu). */
export function diagramContentBox(width?: number, height?: number): ContentBox {
  if (!width || !height) return FULL_BOX;
  const r = width / height;
  const p = diagramPanelRatio(width, height);
  return r >= p ? { cw: 1, ch: p / r } : { cw: r / p, ch: 1 };
}

/**
 * Translation maximale (% du panneau) qui ne découvre pas les bords du schéma
 * au zoom `scale` : 0 tant que le schéma zoomé ne remplit pas cet axe.
 */
function maxShift(scale: number, content: number): number {
  return Math.max(0, ((content * scale - 1) / 2) * 100);
}

function boundedFrame(scale: number, tx: number, ty: number, box: ContentBox = FULL_BOX): CameraFrame {
  const b = (v: number, content: number) => clamp(v, -maxShift(scale, content), maxShift(scale, content)) + 0; // + 0 : pas de « -0 »
  return { scale, translateX: b(tx, box.cw), translateY: b(ty, box.ch) };
}

/**
 * Cadrage du schéma : le zoom passe de `fromScale` à `toScale` et le point
 * (focusX, focusY) glisse vers le centre de l'écran au fil de la scène.
 * À utiliser avec `transform: translate(tx%, ty%) scale(s)` et une origine au centre.
 */
export function cameraAt(cam: CameraMotion | undefined, progress: number, box: ContentBox = FULL_BOX): CameraFrame {
  const c = cam ?? DEFAULT_CAMERA;
  const k = easeInOut(progress);
  const scale = c.fromScale + (c.toScale - c.fromScale) * k;
  // Le point focal est à (f - 50) % du schéma, soit (f - 50) × contenu % du panneau,
  // et à s fois plus loin après zoom : on le recentre d'une fraction k.
  return boundedFrame(scale, (50 - c.focusX) * box.cw * scale * k, (50 - c.focusY) * box.ch * scale * k, box);
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

// ---------------------------------------------------------------------------
// Caméra continue entre scènes
// ---------------------------------------------------------------------------

/** Durée du travelling vers la zone commentée : de MIN à MAX selon la distance parcourue. */
export const CAMERA_MOVE_MS = { min: 900, max: 2400, perPercent: 12 } as const;
/** Léger zoom continu une fois la zone atteinte (le plan ne se fige jamais). */
export const CAMERA_DRIFT = 0.05;

export interface CameraPlan {
  from: CameraFrame;
  to: CameraFrame;
  /** Durée du travelling (ms), proportionnelle à la distance. */
  moveMs: number;
  box: ContentBox;
  /** Facteur de sur-échantillonnage du schéma (précalculé pour éviter un scan par image). */
  oversample: number;
}

/** Ease-in-out sinusoïdal : vitesse de pointe ×1,57 (contre ×3 en cubique), plus doux pour une caméra. */
export function easeInOutSine(p: number): number {
  return (1 - Math.cos(Math.PI * clamp(p, 0, 1))) / 2;
}

function moveDuration(from: CameraFrame, to: CameraFrame): number {
  // Distance perçue : translation (en % du panneau) + changement de zoom (×100).
  const distance = Math.hypot(to.translateX - from.translateX, to.translateY - from.translateY) + Math.abs(to.scale - from.scale) * 100;
  return clamp(CAMERA_MOVE_MS.min + distance * CAMERA_MOVE_MS.perPercent, CAMERA_MOVE_MS.min, CAMERA_MOVE_MS.max);
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Cadrage d'une scène à l'instant t : travelling de `plan.from` vers `plan.to`
 * (ease-in-out sinusoïdal sur `plan.moveMs`, 70 % de la scène au plus), puis
 * dérive lente qui garde la zone centrée.
 */
export function cameraFrameAt(scene: Pick<StoryboardScene, "startMs" | "endMs">, plan: CameraPlan, t: number): CameraFrame {
  const duration = Math.max(1, scene.endMs - scene.startMs);
  const elapsed = clamp(t - scene.startMs, 0, duration);
  const moveMs = Math.min(plan.moveMs, duration * 0.7);
  const k = easeInOutSine(elapsed / moveMs);
  const drift = 1 + CAMERA_DRIFT * clamp((elapsed - moveMs) / Math.max(1, duration - moveMs), 0, 1);
  const scale = lerp(plan.from.scale, plan.to.scale, k) * drift;
  // Translation proportionnelle au zoom : le point focal reste au même endroit pendant la dérive.
  return boundedFrame(
    scale,
    lerp(plan.from.translateX, plan.to.translateX, k) * drift,
    lerp(plan.from.translateY, plan.to.translateY, k) * drift,
    plan.box,
  );
}

/**
 * Plan de caméra de chaque scène. Quand deux scènes consécutives montrent le
 * même schéma, la seconde part exactement du cadrage où la première s'arrête :
 * un seul travelling continu, sans fondu ni retour au plan large.
 */
export function cameraPlans(scenes: readonly StoryboardScene[]): (CameraPlan | null)[] {
  const plans: (CameraPlan | null)[] = [];
  const oversamples = new Map<string, number>();
  scenes.forEach((s, i) => {
    if (s.visualType !== "diagram" || !s.diagramUrl) {
      plans.push(null);
      return;
    }
    const box = diagramContentBox(s.diagramWidth, s.diagramHeight);
    const to = cameraAt(s.cameraMotion, 1, box);
    const prev = scenes[i - 1];
    const prevPlan = plans[i - 1];
    const from =
      prev && prevPlan && prev.diagramUrl === s.diagramUrl
        ? cameraFrameAt(prev, prevPlan, prev.endMs)
        : cameraAt(s.cameraMotion, 0, box);
    let oversample = oversamples.get(s.diagramUrl);
    if (oversample === undefined) {
      oversample = diagramOversample(scenes, s.diagramUrl);
      oversamples.set(s.diagramUrl, oversample);
    }
    plans.push({ from, to, moveMs: moveDuration(from, to), box, oversample });
  });
  return plans;
}

/** Zoom maximal atteint sur un schéma (sur-échantillonnage de l'image, borné à 2). */
export function diagramOversample(scenes: readonly StoryboardScene[], url: string): number {
  let max = 1;
  for (const s of scenes) {
    if (s.diagramUrl === url && s.cameraMotion) max = Math.max(max, s.cameraMotion.fromScale, s.cameraMotion.toScale);
  }
  return Math.min(2, max * (1 + CAMERA_DRIFT));
}

/** `transform` CSS d'une image sur-échantillonnée ×S, centrée dans son panneau. */
export function cameraTransform(frame: CameraFrame, oversample: number): string {
  const s = oversample;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `translate(-50%, -50%) translate3d(${r(frame.translateX / s)}%, ${r(frame.translateY / s)}%, 0) scale(${r(frame.scale / s)})`;
}

// ---------------------------------------------------------------------------
// Horloge lissée
// ---------------------------------------------------------------------------

/**
 * `audio.currentTime` n'avance que par paliers sur Safari iOS et Firefox
 * (jusqu'à ~250 ms) : la caméra saccaderait. L'horloge extrapole avec
 * `performance.now()` depuis le dernier palier, rattrape l'écart en douceur,
 * reste monotone pendant la lecture et se recale d'un coup sur un saut (seek).
 */
export class SmoothClock {
  private anchorAudio = 0;
  private anchorPerf = 0;
  private lastRaw = Number.NaN;
  private lastPerf = Number.NaN;
  private out = 0;

  /** Temps lissé (ms) pour l'image courante. */
  sample(rawMs: number, perfNow: number, rate: number): number {
    if (rawMs !== this.lastRaw) {
      this.lastRaw = rawMs;
      this.anchorAudio = rawMs;
      this.anchorPerf = perfNow;
    }
    // Pas d'extrapolation au-delà de 300 ms sans nouveau palier (mise en mémoire tampon).
    const target = Math.min(this.anchorAudio + (perfNow - this.anchorPerf) * rate, rawMs + 300 * rate);
    if (Number.isNaN(this.lastPerf) || Math.abs(target - this.out) > 250) {
      this.out = target;
    } else {
      const step = this.out + (perfNow - this.lastPerf) * rate;
      this.out = Math.max(this.out, step + (target - step) * 0.2);
    }
    this.lastPerf = perfNow;
    return this.out;
  }

  /** À appeler en pause / après un seek : le prochain échantillon repart de l'audio. */
  reset(rawMs = 0) {
    this.lastRaw = Number.NaN;
    this.lastPerf = Number.NaN;
    this.out = rawMs;
  }
}

/** Visibilité du titre d'accroche en début de capsule. */
export function hookVisible(hookEndMs: number, t: number): boolean {
  return t <= Math.max(hookEndMs, 1500) + 600;
}

/**
 * Clé de rendu React : ne change que quand le texte affiché change (mot, ligne,
 * scène, accroche, apparition des lignes d'une carte). Le reste (caméra, barre de
 * progression) est peint directement à chaque image, sans re-rendu.
 */
export function renderKey(
  sb: { scenes: readonly StoryboardScene[]; wordTimings: readonly WordTimestamp[]; hookEndMs?: number },
  t: number,
): string {
  const w = indexAt(sb.wordTimings, t);
  const wordDone = w >= 0 && t >= sb.wordTimings[w].endMs;
  const si = Math.max(0, indexAt(sb.scenes, t));
  const step = sb.scenes[si]?.visualType === "comparison_card" ? Math.floor(sceneProgress(sb.scenes[si], t) * 20) : 0;
  const hook = sb.hookEndMs !== undefined && hookVisible(sb.hookEndMs, t) ? 1 : 0;
  return `${w}|${wordDone ? 1 : 0}|${si}|${step}|${hook}`;
}
