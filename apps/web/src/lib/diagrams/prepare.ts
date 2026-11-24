/**
 * Préparation serveur des schémas générés proposés par le script (phase 3.5) :
 * seuls ceux qu'une scène montre sont gardés, vérifiés (fidélité, modèle LITE,
 * journalisé dans `ai_usage`), puis mis en page (elkjs). Un échec n'arrête
 * jamais la capsule : les scènes concernées reviennent à `kinetic_text`.
 */
import "server-only";
import { ThinkingLevel, generateStructured, type UsageContext } from "@/lib/ai/gemini";
import type { PreparedDiagram } from "@/lib/episodes/storyboard";
import type { EpisodeScript } from "@/lib/episodes/script";
import { FIDELITY_SYSTEM, FidelityReport, type FidelityVerdict, fidelityPrompt, fidelityVerdict } from "./fidelity";
import { layoutDiagram } from "./layout";
import { normalizeRef, toDiagramSpec } from "./spec";

export interface GeneratedDiagramsMetrics {
  proposed: number;
  /** Proposés ET montrés par au moins une scène. */
  used: number;
  kept: number;
  rejected: number;
  details: ({ ref: string; template: string; nodes: number; edges: number; error?: string } & FidelityVerdict)[];
  fidelityModel?: string;
  fidelityError?: string;
}

export async function prepareGeneratedDiagrams(
  script: EpisodeScript,
  source: { sourceText: { page: number; text: string }[]; summary: string | null },
  ctx: Omit<UsageContext, "task">,
): Promise<{ diagrams: Map<string, PreparedDiagram>; metrics: GeneratedDiagramsMetrics; costUsd: number }> {
  const proposed = script.generatedDiagrams ?? [];
  const shown = new Set(
    script.scenes.flatMap((s) => (s.visualType === "generated_diagram" && s.generatedDiagramRef ? [normalizeRef(s.generatedDiagramRef)] : [])),
  );
  const candidates = proposed
    .map((d) => ({ ref: normalizeRef(d.ref), spec: toDiagramSpec(d) }))
    .filter((d) => shown.has(d.ref));
  const metrics: GeneratedDiagramsMetrics = { proposed: proposed.length, used: candidates.length, kept: 0, rejected: 0, details: [] };
  const diagrams = new Map<string, PreparedDiagram>();
  if (!candidates.length) return { diagrams, metrics, costUsd: 0 };

  // 1. Fidélité : un seul appel pour tous les schémas de la capsule.
  let report: FidelityReport | null = null;
  let costUsd = 0;
  try {
    const res = await generateStructured(FidelityReport, {
      task: "episode.diagram-fidelity",
      tier: "lite",
      // Vérification élément par élément : un peu de réflexion (MINIMAL par défaut pour LITE).
      thinkingLevel: ThinkingLevel.LOW,
      systemInstruction: FIDELITY_SYSTEM,
      contents: fidelityPrompt(source.sourceText, source.summary, candidates),
      ...ctx,
      metadata: { ...ctx.metadata, diagrams: candidates.map((c) => c.ref) },
    });
    report = res.data;
    costUsd = res.costUsd;
    metrics.fidelityModel = res.model;
  } catch (err) {
    metrics.fidelityError = err instanceof Error ? err.message : String(err);
  }

  // 2. Mise en page des schémas attestés.
  for (const c of candidates) {
    const verdict = fidelityVerdict(c.spec, report?.diagrams.find((d) => normalizeRef(d.ref) === c.ref));
    const detail: GeneratedDiagramsMetrics["details"][number] = {
      ref: c.ref,
      template: c.spec.template,
      nodes: c.spec.nodes.length,
      edges: c.spec.edges.length,
      ...verdict,
    };
    if (verdict.ok) {
      try {
        diagrams.set(c.ref, { spec: c.spec, layout: await layoutDiagram(c.spec) });
      } catch (err) {
        detail.ok = false;
        detail.error = `mise en page : ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    metrics.details.push(detail);
  }
  metrics.kept = diagrams.size;
  metrics.rejected = candidates.length - diagrams.size;
  return { diagrams, metrics, costUsd };
}
