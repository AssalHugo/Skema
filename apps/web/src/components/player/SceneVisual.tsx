"use client";
import { AnimatePresence, motion } from "framer-motion";
import { comparisonItemOrder, diagramPanelRatio, sceneProgress } from "@/lib/player/timeline";
import type { StoryboardScene } from "@/lib/storyboard/types";

/** Élément sur lequel le lecteur peint la caméra à chaque image (hors rendu React). */
export type CameraTarget = (el: HTMLImageElement | null) => void | (() => void);

/**
 * Visuel d'une scène : schéma (caméra peinte par le lecteur via `cameraRef`),
 * texte cinétique ou carte comparative.
 */
export function SceneVisual({
  scene,
  timeMs,
  cameraRef,
  oversample = 1,
}: {
  scene: StoryboardScene;
  timeMs: number;
  cameraRef?: CameraTarget;
  /** Facteur de sur-échantillonnage du schéma (zoom maximal de ses scènes). */
  oversample?: number;
}) {
  const progress = sceneProgress(scene, timeMs);

  if (scene.visualType === "diagram" && scene.diagramUrl) {
    const ratio = diagramPanelRatio(scene.diagramWidth, scene.diagramHeight);
    return (
      <div className="relative flex h-full w-full items-center justify-center [container-type:size]">
        <div
          className="relative overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_-20px_rgba(52,211,153,.35)] ring-1 ring-white/10"
          style={{ aspectRatio: String(ratio), width: `min(100cqw, calc(100cqh * ${ratio}))` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- WebP déjà optimisé sur R2 */}
          <img
            ref={cameraRef}
            src={scene.diagramUrl}
            crossOrigin="anonymous"
            alt={scene.calloutLabel ?? "Schéma du cours"}
            draggable={false}
            decoding="async"
            // Image ×oversample réduite par la caméra : rastérisée une fois en haute
            // définition, elle reste nette au zoom et ne se re-rastérise pas à chaque image.
            className="absolute left-1/2 top-1/2 max-w-none select-none object-contain will-change-transform [backface-visibility:hidden]"
            style={{
              width: `${oversample * 100}%`,
              height: `${oversample * 100}%`,
              padding: `${0.5 * oversample}rem`,
              transform: `translate(-50%, -50%) scale(${1 / oversample})`,
            }}
          />
          <AnimatePresence>
            {scene.calloutLabel && (
              <motion.span
                key={scene.calloutLabel}
                initial={{ opacity: 0, y: -8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ delay: 0.25, type: "spring", stiffness: 420, damping: 26 }}
                className="absolute left-3 top-3 rounded-full bg-zinc-950/90 px-3 py-1 text-sm font-bold text-accent shadow-lg"
              >
                ● {scene.calloutLabel}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (scene.visualType === "comparison_card" && scene.comparison) {
    const c = scene.comparison;
    const columns: [string, string[], string][] = [
      [c.leftTitle, c.leftItems, "text-sky-300 border-sky-300/30 bg-sky-300/5"],
      [c.rightTitle, c.rightItems, "text-accent border-accent/30 bg-accent/5"],
    ];
    const total = c.leftItems.length + c.rightItems.length;
    // Les lignes apparaissent au fil de la scène (sur ses 70 premiers pourcents).
    const shown = Math.ceil(Math.min(1, progress / 0.7) * total);
    return (
      <div className="grid h-full w-full grid-cols-2 content-center gap-3">
        {columns.map(([title, items, tone], col) => (
          <div key={col} className={`flex flex-col gap-2 rounded-3xl border p-4 ${tone}`}>
            <p className="text-base font-black uppercase tracking-wide">{title}</p>
            <ul className="flex flex-col gap-2 text-[0.9rem] leading-snug text-white">
              {items.map((it, k) => {
                const visible = comparisonItemOrder(col as 0 | 1, k, c.leftItems.length, c.rightItems.length) < Math.max(1, shown);
                return (
                  <motion.li
                    key={`${col}-${k}`}
                    initial={false}
                    animate={{ opacity: visible ? 1 : 0, x: visible ? 0 : col === 0 ? -12 : 12 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-xl bg-white/5 px-2 py-1.5"
                  >
                    {it}
                  </motion.li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  const text = scene.highlightText ?? scene.calloutLabel ?? "";
  return (
    <div className="flex h-full w-full items-center justify-center">
      <p
        className="text-balance text-center font-black leading-[1.15] tracking-tight"
        style={{ fontSize: text.length <= 10 ? "3.4rem" : text.length <= 20 ? "2.5rem" : "1.9rem" }}
      >
        {kineticWords(text).map((word, i) => (
          <motion.span
            key={`${scene.id}-${i}`}
            initial={{ opacity: 0, y: 24, rotate: -4 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.08 * i, type: "spring", stiffness: 300, damping: 18 }}
            className="mx-[0.12em] inline-block bg-gradient-to-br from-white to-accent bg-clip-text pb-[0.08em] text-transparent"
          >
            {word}
          </motion.span>
        ))}
      </p>
    </div>
  );
}

/** Mots du texte cinétique ; la ponctuation haute française reste collée au mot précédent. */
function kineticWords(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (/^[:;!?»%]+$/.test(w) && out.length) out[out.length - 1] += `\u00a0${w}`;
    else out.push(w);
  }
  return out;
}
