"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FeedItem, ProgressUpdate } from "@/lib/feed/types";
import {
  cameraFrameAt,
  cameraPlans,
  cameraTransform,
  hookVisible,
  indexAt,
  renderKey,
  sceneProgress,
  SmoothClock,
  watchedPct,
} from "@/lib/player/timeline";
import { DynamicCaptions } from "./DynamicCaptions";
import { QuizOverlay } from "./QuizOverlay";
import { SceneVisual } from "./SceneVisual";

/**
 * Lecteur Live Web Rendering d'une capsule générée : le `<audio>` partagé du
 * feed est l'horloge (boucle rAF sur `currentTime`), le storyboard est rendu
 * en DOM (schéma + caméra, sous-titres karaoké, quiz final).
 */
export function LiveCapsulePlayer({
  item,
  index,
  count,
  active,
  started,
  audioRef,
  rate,
  onRateClick,
  onNext,
  reportProgress,
  exitHref,
}: {
  item: FeedItem;
  index: number;
  count: number;
  /** Carte visible : elle seule pilote l'audio partagé. */
  active: boolean;
  /** Session lancée (geste utilisateur reçu, audio déverrouillé sur iOS). */
  started: boolean;
  /** `<audio>` unique du feed (déverrouillé une fois sur iOS). */
  audioRef: RefObject<HTMLAudioElement | null>;
  rate: number;
  onRateClick: () => void;
  onNext: () => void;
  reportProgress: (update: ProgressUpdate) => void;
  exitHref: string;
}) {
  const sb = item.storyboard;
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [audioError, setAudioError] = useState<"blocked" | "failed" | null>(null);
  const maxTimeRef = useRef(0);
  const lastReportedPctRef = useRef(item.progress?.watchedPct ?? 0);
  /** Temps lissé de l'image courante (peinture directe, sans re-rendu). */
  const timeRef = useRef(0);
  const renderKeyRef = useRef("");
  const [clock] = useState(() => new SmoothClock());
  const cameraElRef = useRef<HTMLImageElement | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const plans = useMemo(() => cameraPlans(sb.scenes), [sb.scenes]);

  /** Peint la caméra du schéma et la barre de progression pour l'instant t. */
  const paint = useCallback(
    (t: number) => {
      const si = Math.max(0, indexAt(sb.scenes, t));
      const scene = sb.scenes[si];
      const plan = plans[si];
      const img = cameraElRef.current;
      if (img && plan && scene?.diagramUrl) {
        img.style.transform = cameraTransform(cameraFrameAt(scene, plan, t), plan.oversample);
      }
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const fill = i < si ? 1 : i > si ? 0 : sceneProgress(sb.scenes[i], t);
        bar.style.transform = `scaleX(${fill})`;
      });
    },
    [plans, sb.scenes],
  );

  /** Fixe le temps affiché hors lecture (pause, fin, relance). */
  const showTime = useCallback(
    (t: number) => {
      timeRef.current = t;
      renderKeyRef.current = renderKey(sb, t);
      setTimeMs(t);
    },
    [sb],
  );

  const cameraRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el) return;
      cameraElRef.current = el;
      paint(timeRef.current);
      return () => {
        if (cameraElRef.current === el) cameraElRef.current = null;
      };
    },
    [paint],
  );

  // Après chaque rendu (changement de scène, pause, carte inactive) : repeindre l'instant courant.
  useLayoutEffect(() => {
    paint(timeRef.current);
  });

  // Activation : la carte prend l'audio partagé, le quitte en partant.
  useEffect(() => {
    const audio = audioRef.current;
    if (!active || !started || !audio) return;
    let cancelled = false;
    const url = new URL(sb.audioUrl, window.location.href).href;
    if (audio.src !== url) {
      audio.src = url;
      audio.currentTime = 0;
      clock.reset(0);
    }
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    const flushProgress = () => {
      const pct = watchedPct(maxTimeRef.current, sb.totalDurationMs);
      if (pct > lastReportedPctRef.current && pct < 100) {
        lastReportedPctRef.current = pct;
        reportProgress({ episodeId: item.episodeId, watchedPct: pct });
      }
    };
    const onPlay = () => {
      if (cancelled) return;
      setPlaying(true);
      setEnded(false);
      setAudioError(null);
    };
    const onPause = () => {
      if (cancelled) return;
      setPlaying(false);
      clock.reset(audio.currentTime * 1000);
      showTime(audio.currentTime * 1000);
    };
    const onEnded = () => {
      if (cancelled) return;
      setPlaying(false);
      setEnded(true);
      showTime(sb.totalDurationMs);
      maxTimeRef.current = sb.totalDurationMs;
      if (lastReportedPctRef.current < 100) {
        lastReportedPctRef.current = 100;
        reportProgress({ episodeId: item.episodeId, watchedPct: 100 });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // La 1re capsule a déjà démarré dans le geste « Lancer la session » : l'événement
    // `play` est passé avant l'abonnement, d'où la synchronisation à la résolution.
    audio.play().then(onPlay, (err: unknown) => {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAudioError(err instanceof DOMException && err.name === "NotAllowedError" ? "blocked" : "failed");
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.courseTitle, album: "Skema" });
    }
    return () => {
      cancelled = true;
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      audio.pause();
      setPlaying(false);
      setAudioError(null);
      setEnded(false);
      clock.reset(0);
      showTime(0);
      flushProgress();
    };
    // `rate` est appliqué par l'effet suivant : il ne doit pas relancer la capsule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, started, audioRef, sb, item.episodeId, item.title, item.courseTitle, reportProgress, clock, showTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (active && audio) {
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    }
  }, [active, audioRef, rate]);

  // Horloge : rAF sur currentTime lissé. Caméra et progression sont peintes à
  // chaque image ; React ne re-rend que quand le texte affiché change.
  useEffect(() => {
    const audio = audioRef.current;
    if (!active || !playing || !audio) return;
    clock.reset(audio.currentTime * 1000);
    let frame = 0;
    const loop = (now: number) => {
      const t = Math.min(sb.totalDurationMs, clock.sample(audio.currentTime * 1000, now, audio.playbackRate));
      timeRef.current = t;
      maxTimeRef.current = Math.max(maxTimeRef.current, t);
      paint(t);
      const key = renderKey(sb, t);
      if (key !== renderKeyRef.current) {
        renderKeyRef.current = key;
        setTimeMs(t);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active, playing, audioRef, clock, paint, sb]);

  function handlePlayError(err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    setAudioError(err instanceof DOMException && err.name === "NotAllowedError" ? "blocked" : "failed");
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !active || ended) return;
    if (audio.paused) audio.play().catch(handlePlayError);
    else audio.pause();
  }

  function replay() {
    const audio = audioRef.current;
    if (!audio) return;
    const shouldReload = audioError === "failed";
    setEnded(false);
    setAudioError(null);
    if (shouldReload) audio.load();
    audio.currentTime = 0;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    clock.reset(0);
    showTime(0);
    audio.play().catch(handlePlayError);
  }

  const sceneIndex = Math.max(0, indexAt(sb.scenes, timeMs));
  const scene = sb.scenes[sceneIndex];
  const showHook = hookVisible(sb.hookEndMs, timeMs);
  const paused = started && active && !playing && !ended && !audioError;

  return (
    <div className="relative flex h-full w-full select-none flex-col overflow-hidden bg-[radial-gradient(120%_80%_at_50%_0%,#15241f_0%,#0a0a0a_60%)]" onClick={togglePlay}>
      {/* En-tête : cours, chapitre, position, vitesse */}
      <header className="relative z-10 flex items-start gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Link
          href={exitHref}
          onClick={(e) => e.stopPropagation()}
          aria-label="Quitter la session"
          className="-ml-1 grid size-8 shrink-0 place-items-center rounded-full text-lg text-white/70"
        >
          ✕
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.7rem] font-semibold uppercase tracking-widest text-accent">{item.courseTitle}</p>
          <p className="truncate text-sm text-white/70">{item.chapterTitle}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-white/50">
          {index + 1}/{count}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRateClick();
          }}
          className="shrink-0 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-xs font-bold tabular-nums backdrop-blur"
          aria-label="Vitesse de lecture"
        >
          {String(rate).replace(".", ",")}x
        </button>
      </header>

      {/* Accroche (< 5 s) */}
      <div className="relative z-10 flex min-h-[4.5rem] items-center justify-center px-6 pt-3">
        <AnimatePresence>
          {showHook && (
            <motion.h2
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="text-balance text-center text-[1.7rem] font-black leading-tight tracking-tight"
            >
              {sb.hookTitle}
            </motion.h2>
          )}
        </AnimatePresence>
      </div>

      {/* Visuel de la scène */}
      <div className="relative min-h-0 flex-1 px-4 py-3">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            // Scènes consécutives sur le même schéma : même élément, la caméra glisse sans fondu.
            key={scene.visualType === "diagram" && scene.diagramUrl ? `diagram:${scene.diagramUrl}` : scene.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute inset-x-4 inset-y-3"
          >
            <SceneVisual
              scene={scene}
              timeMs={timeMs}
              cameraRef={cameraRef}
              oversample={plans[sceneIndex]?.oversample ?? 1}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sous-titres et progression par scène */}
      <div className="relative z-10 flex flex-col gap-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <DynamicCaptions storyboard={sb} timeMs={timeMs} />
        <div className="flex gap-1 px-4" aria-hidden>
          {sb.scenes.map((s, i) => (
            <div key={s.id} className="h-1 overflow-hidden rounded-full bg-white/15" style={{ flexGrow: Math.max(1, s.endMs - s.startMs) }}>
              {/* Remplissage peint à chaque image par `paint()` */}
              <div
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
                className="h-full origin-left rounded-full bg-white will-change-transform"
                style={{ transform: "scaleX(0)" }}
              />
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {paused && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2 }}
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          >
            <span className="grid size-20 place-items-center rounded-full bg-black/50 text-3xl backdrop-blur">▶</span>
          </motion.div>
        )}
      </AnimatePresence>

      {audioError && active && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            replay();
          }}
          className="absolute inset-x-8 bottom-1/3 z-20 rounded-2xl bg-accent py-4 font-bold text-black shadow-xl"
        >
          {audioError === "blocked" ? "🔊 Activer le son" : "↻ Réessayer le chargement audio"}
        </button>
      )}

      {ended && active && (
        <QuizOverlay
          quiz={sb.quiz}
          hasNext={index + 1 < count}
          onAnswer={(correct) => reportProgress({ episodeId: item.episodeId, quizCorrect: correct })}
          onReplay={replay}
          onNext={onNext}
        />
      )}
    </div>
  );
}
