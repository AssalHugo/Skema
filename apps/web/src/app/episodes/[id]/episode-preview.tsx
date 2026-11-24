"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DIAGRAM_BACKGROUND, GeneratedDiagram } from "@/components/player/GeneratedDiagram";
import type { EpisodeForUser } from "@/lib/episodes/queries";
import { cameraFrameAt, cameraPlans, findGeneratedDiagram, indexAt } from "@/lib/player/timeline";
import type { GeneratedStoryboard, StoryboardScene } from "@/lib/storyboard/types";

const RATES = [1, 1.25, 1.5];

export function EpisodePreview({ episode }: { episode: EpisodeForUser }) {
  const sb = episode.storyboard;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const plans = useMemo(() => (sb ? cameraPlans(sb.scenes) : []), [sb]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = () => {
      const audio = audioRef.current;
      if (audio) setTimeMs(audio.currentTime * 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function changeRate(r: number) {
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }

  async function regenerate() {
    setMessage(null);
    const res = await fetch(`/api/episodes/${episode.id}/regenerate`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(res.ok ? "Régénération lancée : revenir sur la page du cours pour suivre l'avancement." : (body.error ?? `Erreur ${res.status}`));
  }

  const back = episode.courseId ? (
    <Link href={`/courses/${episode.courseId}`} className="text-sm text-muted">
      ← {episode.courseTitle}
    </Link>
  ) : null;

  if (!sb || episode.status !== "ready") {
    return (
      <>
        {back}
        <h1 className="text-2xl font-bold">{episode.title}</h1>
        <p className="text-muted">
          {episode.status === "failed" ? <span className="text-red-400">Échec : {episode.error}</span> : "Capsule en cours de génération…"}
        </p>
        {episode.status === "failed" && (
          <>
            <button
              type="button"
              onClick={regenerate}
              className="self-start rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold"
            >
              Régénérer la capsule
            </button>
            {message && <p className="text-sm text-muted">{message}</p>}
          </>
        )}
      </>
    );
  }

  const sceneIndex = Math.max(0, indexAt(sb.scenes, timeMs));
  const scene = sb.scenes[sceneIndex];
  const segment = sb.displaySegments[Math.max(0, indexAt(sb.displaySegments, timeMs))];
  const wordIndex = indexAt(sb.wordTimings, timeMs);
  const metrics = (episode.metrics ?? {}) as Record<string, unknown>;

  return (
    <>
      {back}
      <h1 className="text-2xl font-bold">{episode.title}</h1>

      <div className="relative mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
        {scene.visualType === "generated_diagram" && findGeneratedDiagram(sb.generatedDiagrams, scene.generatedDiagramId) ? (
          <div className="absolute inset-0 flex items-center p-3 pt-24 pb-28" style={{ background: DIAGRAM_BACKGROUND }}>
            <GeneratedDiagram
              diagram={findGeneratedDiagram(sb.generatedDiagrams, scene.generatedDiagramId)!}
              tMs={timeMs}
              frame={plans[sceneIndex] ? cameraFrameAt(scene, plans[sceneIndex]!, timeMs) : undefined}
              focusNodeId={scene.focusNodeId}
            />
          </div>
        ) : (
          <SceneVisual scene={scene} timeMs={timeMs} />
        )}
        {sceneIndex === 0 && (
          <p className="absolute inset-x-4 top-6 text-center text-xl font-bold drop-shadow">{sb.hookTitle}</p>
        )}
        {scene.calloutLabel && (
          <p className="absolute left-4 top-20 rounded bg-accent px-2 py-1 text-sm font-semibold text-black">
            {scene.calloutLabel}
          </p>
        )}
        {segment && (
          <p className="absolute inset-x-3 bottom-8 text-center text-lg font-semibold leading-snug drop-shadow">
            {sb.wordTimings.slice(segment.startWord, segment.endWord).map((w, k) => {
              const i = segment.startWord + k;
              return (
                <span key={i} className={i === wordIndex ? "rounded bg-yellow-300 px-0.5 text-black" : ""}>
                  {w.word}{" "}
                </span>
              );
            })}
          </p>
        )}
      </div>

      <audio
        ref={audioRef}
        src={sb.audioUrl}
        controls
        preload="auto"
        className="w-full"
        onPlay={() => {
          setEnded(false);
          setPlaying(true);
        }}
        onPause={(e) => {
          setPlaying(false);
          setTimeMs(e.currentTarget.currentTime * 1000);
        }}
        onEnded={(e) => {
          setPlaying(false);
          setEnded(true);
          setTimeMs(e.currentTarget.currentTime * 1000);
        }}
        onSeeked={(e) => setTimeMs(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => (e.currentTarget.playbackRate = rate)}
      />
      <div className="flex items-center gap-2 text-sm">
        Vitesse :
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => changeRate(r)}
            className={`rounded border px-2 py-1 ${r === rate ? "border-accent text-accent" : "border-white/20"}`}
          >
            {String(r).replace(".", ",")}x
          </button>
        ))}
        <span className="ml-auto text-muted">
          {(timeMs / 1000).toFixed(1)} / {(sb.totalDurationMs / 1000).toFixed(1)} s · scène {sceneIndex + 1}/{sb.scenes.length}
        </span>
      </div>

      <Quiz storyboard={sb} highlight={ended} />
      <Checks metrics={metrics} storyboard={sb} episode={episode} />

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Script annoté et SSML</summary>
        <p className="mt-2 whitespace-pre-wrap">{sb.annotatedScript}</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted">{sb.ssmlWithSub}</pre>
      </details>

      <button
        type="button"
        onClick={regenerate}
        className="self-start rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold"
      >
        Régénérer la capsule
      </button>
      {message && <p className="text-sm text-muted">{message}</p>}
    </>
  );
}

function SceneVisual({ scene, timeMs }: { scene: StoryboardScene; timeMs: number }) {
  if (scene.visualType === "diagram" && scene.diagramUrl) {
    const cam = scene.cameraMotion ?? { fromScale: 1, toScale: 1, focusX: 50, focusY: 50 };
    const span = Math.max(1, scene.endMs - scene.startMs);
    const p = Math.min(1, Math.max(0, (timeMs - scene.startMs) / span));
    const scale = cam.fromScale + (cam.toScale - cam.fromScale) * p;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- WebP déjà optimisé sur R2 */}
        <img
          src={scene.diagramUrl}
          crossOrigin="anonymous"
          alt={scene.calloutLabel ?? "Schéma du cours"}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `scale(${scale})`, transformOrigin: `${cam.focusX}% ${cam.focusY}%` }}
        />
      </div>
    );
  }
  if (scene.visualType === "comparison_card" && scene.comparison) {
    const c = scene.comparison;
    return (
      <div className="absolute inset-0 grid grid-cols-2 gap-2 p-4 pt-28 text-sm">
        {[
          [c.leftTitle, c.leftItems],
          [c.rightTitle, c.rightItems],
        ].map(([title, items], k) => (
          <div key={k} className="rounded-lg bg-white/10 p-2">
            <p className="mb-2 font-bold text-accent">{title as string}</p>
            <ul className="flex flex-col gap-1">
              {(items as string[]).map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <p className="text-center text-3xl font-black text-accent">{scene.highlightText}</p>
    </div>
  );
}

function Quiz({ storyboard, highlight }: { storyboard: GeneratedStoryboard; highlight: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  const q = storyboard.quiz;
  return (
    <section className={`flex flex-col gap-2 rounded-lg border p-4 ${highlight ? "border-accent" : "border-white/10"}`}>
      <p className="font-semibold">{q.question}</p>
      {q.choices.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setPicked(i)}
          className={`rounded border px-3 py-2 text-left text-sm ${
            picked === null
              ? "border-white/20"
              : i === q.correctIndex
                ? "border-accent text-accent"
                : i === picked
                  ? "border-red-400 text-red-400"
                  : "border-white/10 text-muted"
          }`}
        >
          {c}
        </button>
      ))}
      {picked !== null && <p className="text-sm text-muted">{q.explanation}</p>}
    </section>
  );
}

function Checks({
  metrics,
  storyboard,
  episode,
}: {
  metrics: Record<string, unknown>;
  storyboard: GeneratedStoryboard;
  episode: EpisodeForUser;
}) {
  const tts = (metrics.tts ?? {}) as { verdict?: { ok: boolean; fails: string[]; markCoveragePct?: number } | null; usedFallback?: boolean };
  const unannotated = (metrics.unannotatedTerms as string[] | undefined) ?? [];
  const generated = metrics.generatedDiagrams as
    | {
        proposed: number;
        kept: number;
        rejected: number;
        details?: { ref: string; ok: boolean; unsupportedNodes: string[]; unsupportedEdges: string[] }[];
      }
    | undefined;
  const ok = (v: boolean | undefined) => (v === undefined ? "—" : v ? "✅" : "⚠️");
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-white/10 p-4 text-sm">
      <p className="font-semibold">Contrôles (critères de fin de la phase 2)</p>
      <p>
        {ok(metrics.wordsInRange as boolean | undefined)} {String(metrics.words ?? "?")} mots (cible 150–210) ·{" "}
        {storyboard.scenes.length} scènes
      </p>
      <p>
        {ok(metrics.hookUnder5s as boolean | undefined)} accroche : {(storyboard.hookEndMs / 1000).toFixed(1)} s (cible &lt; 5 s)
      </p>
      <p>
        {ok(tts.verdict?.ok)} seuils de S.3 : marks {tts.verdict?.markCoveragePct ?? "?"} %
        {tts.verdict?.fails.length ? ` — ${tts.verdict.fails.join(", ")}` : ""}
        {tts.usedFallback ? " (repli TTS utilisé)" : ""}
      </p>
      {generated && (
        <p>
          {ok(generated.rejected === 0)} schémas générés : {generated.kept}/{generated.proposed} retenus après vérification de
          fidélité
          {generated.details
            ?.filter((d) => !d.ok)
            .map((d) => ` — ${d.ref} refusé (${[...d.unsupportedNodes, ...d.unsupportedEdges].join(", ") || "erreur"})`)
            .join("")}
        </p>
      )}
      <p>
        {ok(unannotated.length === 0)} termes non annotés : {unannotated.length ? unannotated.join(", ") : "aucun"}
      </p>
      <p className="text-muted">
        {episode.ttsVoice} · {episode.modelUsed} · {episode.costUsd?.toFixed(4) ?? "?"} $ — à l&apos;oreille : prononciation et
        calage du surlignage à 1x et 1,25x.
      </p>
    </section>
  );
}
