/**
 * Schéma Zod des schémas 2D proposés par le LLM (phase 3.5) : une STRUCTURE
 * (nœuds, liens), jamais un dessin. Bornes : 2 à 12 nœuds, libellés de 40
 * caractères au plus, liens et `focusNodeId` limités aux `id` déclarés.
 */
import { z } from "zod";
import type { DiagramSpec, DiagramTemplate } from "@/lib/storyboard/types";
import { displayText } from "@/lib/tts/ssml";

export const DIAGRAM_TEMPLATES = ["pathway", "cycle", "stages"] as const satisfies readonly DiagramTemplate[];
export const DIAGRAM_NODES = { min: 2, max: 12 } as const;
export const DIAGRAM_LABEL_MAX = 40;
export const DIAGRAM_EDGE_LABEL_MAX = 24;
/** Schémas générés par capsule au plus. */
export const MAX_GENERATED_DIAGRAMS = 2;

export const DiagramSpecInput = z.object({
  ref: z.string().describe("Référence G1, G2…, utilisée par les scènes (generatedDiagramRef)"),
  template: z
    .enum(DIAGRAM_TEMPLATES)
    .describe("pathway = flux orienté ; cycle = boucle fermée ; stages = étapes successives"),
  title: z.string().nullable().describe("Titre court du schéma (40 caractères max), ou null"),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Identifiant court sans espace (ex. glucose, g6p, phase1)"),
        label: z.string().describe(`Libellé affiché, ${DIAGRAM_LABEL_MAX} caractères max, terme exact du cours`),
        group: z.string().nullable().describe("Catégorie facultative (couleur), ex. enzyme, substrat ; ou null"),
      }),
    )
    .min(DIAGRAM_NODES.min)
    .max(DIAGRAM_NODES.max),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().nullable().describe(`Étiquette du lien (${DIAGRAM_EDGE_LABEL_MAX} caractères max : enzyme, réactif…), ou null`),
    }),
  ),
});
export type DiagramSpecInput = z.infer<typeof DiagramSpecInput>;

export const normalizeRef = (ref: string) => ref.trim().toUpperCase();

/**
 * Erreurs de cohérence d'un schéma (vide si valide) : identifiants uniques,
 * liens vers des nœuds existants, pas de boucle ni de doublon, longueurs.
 */
export function diagramSpecIssues(d: DiagramSpecInput): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (!n.id.trim()) issues.push("nœud sans id");
    if (ids.has(n.id)) issues.push(`id de nœud en double : ${n.id}`);
    ids.add(n.id);
    const label = displayText(n.label).trim();
    if (!label) issues.push(`nœud ${n.id} sans libellé`);
    if (label.length > DIAGRAM_LABEL_MAX) issues.push(`libellé de ${n.id} trop long (${label.length} > ${DIAGRAM_LABEL_MAX})`);
  }
  const keys = new Set<string>();
  for (const e of d.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) issues.push(`lien ${e.from} → ${e.to} vers un nœud inconnu`);
    if (e.from === e.to) issues.push(`lien en boucle sur ${e.from}`);
    const key = `${e.from}->${e.to}`;
    if (keys.has(key)) issues.push(`lien en double : ${e.from} → ${e.to}`);
    keys.add(key);
  }
  return issues;
}

const clip = (text: string | null | undefined, max: number): string | undefined => {
  if (!text) return undefined;
  const clean = displayText(text).trim().replace(/\s+/g, " ");
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** Sortie du LLM → `DiagramSpec` du contrat (libellés en version affichée, bornés). */
export function toDiagramSpec(d: DiagramSpecInput): DiagramSpec {
  return {
    template: d.template,
    ...(clip(d.title, DIAGRAM_LABEL_MAX) ? { title: clip(d.title, DIAGRAM_LABEL_MAX) } : {}),
    nodes: d.nodes.map((n) => ({
      id: n.id,
      label: clip(n.label, DIAGRAM_LABEL_MAX) ?? n.id,
      ...(clip(n.group, 24) ? { group: clip(n.group, 24)!.toLowerCase() } : {}),
    })),
    edges: d.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(clip(e.label, DIAGRAM_EDGE_LABEL_MAX) ? { label: clip(e.label, DIAGRAM_EDGE_LABEL_MAX) } : {}),
    })),
  };
}
