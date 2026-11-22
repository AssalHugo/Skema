"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CourseOverview } from "@/lib/courses";

const POLL_MS = 4000;

const STATUS_LABEL: Record<string, string> = {
  pending: "À générer",
  processing: "En cours…",
  ready: "Prêt",
  failed: "Échec",
};

const STRUCTURE_LABEL: Record<string, string> = {
  outline: "signets du PDF",
  headings: "titres « Chapitre … » détectés",
  fixed: "tranches régulières (aucune structure détectée)",
  single: "document court",
};

export function CourseView({ initial }: { initial: CourseOverview }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const { course, chapters } = data;
  const busy = course.status === "processing" || chapters.some((c) => c.status === "processing");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${course.id}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as CourseOverview);
    } catch {
      /* erreur réseau transitoire : le prochain poll reprendra */
    }
  }, [course.id]);

  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy, refresh]);

  async function generate(chapterId: string, force: boolean) {
    setError(null);
    setSubmitting((s) => ({ ...s, [chapterId]: true }));
    try {
      const res = await fetch(`/api/chapters/${chapterId}/generate${force ? "?force=1" : ""}`, { method: "POST" });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Erreur ${res.status}`);
      await refresh();
    } catch {
      setError("Impossible de contacter le serveur");
    } finally {
      setSubmitting((s) => ({ ...s, [chapterId]: false }));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted">
          ← Accueil
        </Link>
        <h1 className="text-3xl font-bold">{course.title}</h1>
        <p className="text-sm text-muted">
          {course.status === "processing" && "Analyse du document (chapitres, lots de pages)…"}
          {course.status === "failed" && <span className="text-red-400">Échec de l&apos;analyse : {course.error}</span>}
          {course.status === "ready" &&
            `${course.pageCount} pages · ${chapters.length} chapitres · découpage : ${
              STRUCTURE_LABEL[course.structureSource ?? ""] ?? course.structureSource
            }`}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {chapters.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-lg border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{c.title}</p>
                <p className="text-sm text-muted">
                  p. {c.pageStart}–{c.pageEnd} ({c.pages} p., {c.batches} lot{c.batches > 1 ? "s" : ""})
                </p>
              </div>
              <span className="shrink-0 text-sm text-muted">{STATUS_LABEL[c.status]}</span>
            </div>
            {c.status === "ready" && (
              <p className="text-sm">
                {c.concepts} concepts · {c.diagrams} schémas
                {c.metrics?.cutTextRatio !== undefined && (
                  <span className={c.metrics.verdict?.ok === false ? "text-amber-400" : "text-muted"}>
                    {" "}
                    · légendes coupées {Math.round(c.metrics.cutTextRatio * 100)} %
                  </span>
                )}
              </p>
            )}
            {c.status === "failed" && <p className="text-sm text-red-400">{c.error}</p>}
            {course.status === "ready" && c.status !== "processing" && (
              <button
                type="button"
                disabled={Boolean(submitting[c.id])}
                onClick={() => generate(c.id, c.status === "ready")}
                className="self-start rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {submitting[c.id]
                  ? "Lancement…"
                  : c.status === "ready"
                    ? "Régénérer"
                    : c.status === "failed"
                      ? "Réessayer"
                      : "Générer les capsules"}
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
