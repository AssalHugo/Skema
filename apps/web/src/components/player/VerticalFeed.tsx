"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, ProgressUpdate } from "@/lib/feed/types";
import { mountedWindow, nextRate } from "@/lib/player/timeline";
import { LiveCapsulePlayer } from "./LiveCapsulePlayer";

const RATE_KEY = "skema.playbackRate";

function readRate(): number {
  try {
    const r = Number(window.localStorage.getItem(RATE_KEY));
    return r === 1.25 || r === 1.5 ? r : 1;
  } catch {
    return 1;
  }
}

/** Envoi de la progression, robuste à la fermeture de l'onglet (`keepalive`). */
export function postProgress(update: ProgressUpdate) {
  fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
    keepalive: true,
  }).catch(() => {
    /* hors ligne : la progression de cette capsule est perdue, sans gêner la lecture */
  });
}

/**
 * Feed vertical plein écran (`100dvh`, scroll-snap), virtualisé sur 3 cartes.
 * Un seul `<audio>` pour toute la session : déverrouillé par le tap sur
 * « Lancer la session », il est ensuite réutilisé à chaque swipe (iOS).
 */
export function VerticalFeed({
  items,
  title,
  exitHref = "/",
  reportProgress = postProgress,
}: {
  items: FeedItem[];
  title: string;
  exitHref?: string;
  reportProgress?: (update: ProgressUpdate) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(0);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    // Préférence locale lue après l'hydratation (localStorage indisponible au rendu serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRate(readRate());
  }, []);

  const cycleRate = useCallback(() => {
    setRate((r) => {
      const n = nextRate(r);
      try {
        window.localStorage.setItem(RATE_KEY, String(n));
      } catch {
        /* navigation privée : préférence non mémorisée */
      }
      return n;
    });
  }, []);

  const scrollToIndex = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: i * el.clientHeight, behavior: "smooth" });
  }, []);

  // Carte active = carte la plus proche du haut du conteneur après le snap.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
        setActive(Math.min(items.length - 1, Math.max(0, i)));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items.length]);

  // Clavier (ordinateur) : flèches pour naviguer, espace pour pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") scrollToIndex(Math.min(items.length - 1, active + 1));
      else if (e.key === "ArrowUp" || e.key === "PageUp") scrollToIndex(Math.max(0, active - 1));
      else if (e.key === " " && audioRef.current) {
        const target = e.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select")) return;
        const audio = audioRef.current;
        if (audio.ended) return;
        if (audio.paused) void audio.play().catch(() => {});
        else audio.pause();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, items.length, scrollToIndex, started]);

  async function start() {
    const audio = audioRef.current;
    if (!audio || items.length === 0 || starting) return;
    setStarting(true);
    // Déverrouillage iOS : la première lecture doit partir du geste utilisateur.
    audio.src = new URL(items[active].storyboard.audioUrl, window.location.href).href;
    audio.currentTime = 0;
    audio.playbackRate = rate;
    try {
      await audio.play();
    } catch {
      /* refus : le lecteur affichera « Activer le son » */
    }
    setStarted(true);
    setStarting(false);
  }

  if (items.length === 0) {
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-2xl font-bold">Aucune capsule prête</p>
        <p className="text-muted">Génère les capsules d&apos;un chapitre depuis la page du cours, puis reviens ici.</p>
        <Link href={exitHref} className="rounded-xl bg-accent px-5 py-3 font-semibold text-black">
          Retour
        </Link>
      </main>
    );
  }

  const { from, to } = mountedWindow(active, items.length);
  const minutes = Math.max(1, Math.round(items.reduce((s, it) => s + it.storyboard.totalDurationMs, 0) / 60000));

  return (
    <div className="fixed inset-0 bg-background">
      <div
        ref={scrollerRef}
        className="h-[100dvh] w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <section key={item.episodeId} className="relative mx-auto h-[100dvh] w-full max-w-[min(100vw,calc(100dvh*9/16))] snap-start snap-always">
            {i >= from && i <= to && (
              <LiveCapsulePlayer
                item={item}
                index={i}
                count={items.length}
                active={i === active}
                started={started}
                audioRef={audioRef}
                rate={rate}
                onRateClick={cycleRate}
                onNext={() => scrollToIndex(i + 1)}
                reportProgress={reportProgress}
                exitHref={exitHref}
              />
            )}
          </section>
        ))}
      </div>

      <audio ref={audioRef} playsInline preload="auto" className="hidden" />

      {!started && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-[radial-gradient(90%_60%_at_50%_30%,#16362b_0%,#0a0a0a_70%)] px-8 text-center"
        >
          <div className="flex flex-col items-center gap-3">
            <span className="grid size-16 place-items-center rounded-2xl bg-accent text-3xl font-black text-black">S</span>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Session de révision</p>
            <h1 className="text-balance text-3xl font-black leading-tight">{title}</h1>
            <p className="text-white/60">
              {items.length} capsule{items.length > 1 ? "s" : ""} · ~{minutes} min · quiz après chaque capsule
            </p>
          </div>
          <motion.button
            type="button"
            disabled={starting}
            whileTap={{ scale: 0.96 }}
            onClick={start}
            className="w-full max-w-xs rounded-2xl bg-accent py-4 text-lg font-black text-black shadow-[0_10px_40px_-10px_rgba(52,211,153,.7)] disabled:opacity-70"
          >
            {starting ? "Démarrage…" : "▶ Lancer la session"}
          </motion.button>
          <p className="max-w-xs text-xs text-white/40">Active le son. Swipe vers le haut pour passer à la capsule suivante, touche l&apos;écran pour mettre en pause.</p>
          <Link href={exitHref} className="text-sm text-white/50 underline underline-offset-4">
            Retour
          </Link>
        </motion.div>
      )}
    </div>
  );
}
