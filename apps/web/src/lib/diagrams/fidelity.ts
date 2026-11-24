/**
 * Vérification de fidélité des schémas générés (phase 3.5, modèle LITE) :
 * chaque nœud et chaque lien doit être attesté par le texte du cours. Un
 * schéma non conforme est abandonné : ses scènes reviennent à `kinetic_text`.
 */
import { z } from "zod";
import type { DiagramSpec } from "@/lib/storyboard/types";
import { edgeKey } from "./text";

export const FidelityReport = z.object({
  diagrams: z.array(
    z.object({
      ref: z.string(),
      nodes: z.array(
        z.object({
          id: z.string(),
          attested: z.boolean().describe("true si le cours mentionne explicitement cet élément"),
          evidence: z.string().nullable().describe("Courte citation du cours qui l'atteste, ou null"),
        }),
      ),
      edges: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          attested: z.boolean().describe("true si le cours atteste cette relation, dans ce sens"),
          evidence: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type FidelityReport = z.infer<typeof FidelityReport>;

export interface FidelityVerdict {
  ok: boolean;
  unsupportedNodes: string[];
  unsupportedEdges: string[];
}

export const FIDELITY_SYSTEM = `Tu es relecteur scientifique. Tu vérifies, élément par élément, qu'un schéma est fidèle à un extrait de cours universitaire. Tu es strict : un élément n'est attesté que si le texte fourni le mentionne (mot exact, synonyme ou forme abrégée évidente) ; une relation n'est attestée que si le texte la décrit, dans ce sens. Tes connaissances générales ne comptent pas.`;

export function fidelityPrompt(
  source: { page: number; text: string }[],
  fallbackSummary: string | null,
  diagrams: { ref: string; spec: DiagramSpec }[],
): string {
  const text = source.length
    ? source.map((s) => `[page ${s.page}]\n${s.text}`).join("\n\n")
    : `(texte des pages indisponible ; résumé du concept)\n${fallbackSummary ?? ""}`;
  const listing = diagrams
    .map(({ ref, spec }) => {
      const nodes = spec.nodes.map((n) => `  - nœud ${n.id} : « ${n.label} »`).join("\n");
      const edges = spec.edges.length
        ? spec.edges.map((e) => `  - lien ${e.from} → ${e.to}${e.label ? ` (« ${e.label} »)` : ""}`).join("\n")
        : "  (aucun lien)";
      return `${ref} (${spec.template}${spec.title ? `, « ${spec.title} »` : ""})\n${nodes}\n${edges}`;
    })
    .join("\n\n");
  return `Texte du cours :
"""
${text}
"""

Schémas à vérifier :
${listing}

Pour CHAQUE schéma (même ref), renvoie TOUS ses nœuds (même id) et TOUS ses liens (mêmes from/to), avec attested = true ou false et une courte citation du cours quand c'est attesté.`;
}

/** Verdict d'un schéma : un élément absent du rapport compte comme non attesté. */
export function fidelityVerdict(spec: DiagramSpec, report: FidelityReport["diagrams"][number] | undefined): FidelityVerdict {
  const nodesOk = new Set((report?.nodes ?? []).filter((n) => n.attested).map((n) => n.id));
  const edgesOk = new Set((report?.edges ?? []).filter((e) => e.attested).map((e) => edgeKey(e.from, e.to)));
  const unsupportedNodes = spec.nodes.filter((n) => !nodesOk.has(n.id)).map((n) => n.id);
  const unsupportedEdges = spec.edges.map((e) => edgeKey(e.from, e.to)).filter((k) => !edgesOk.has(k));
  return { ok: !unsupportedNodes.length && !unsupportedEdges.length, unsupportedNodes, unsupportedEdges };
}
