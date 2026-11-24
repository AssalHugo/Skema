/**
 * Mise en page des schémas générés (phase 3.5), côté serveur uniquement :
 * elkjs (~1,4 Mo, asynchrone) reste hors du bundle PWA. Le résultat
 * (`DiagramLayout`) est figé dans le storyboard : le lecteur n'a plus qu'à
 * dessiner, de façon synchrone et reproductible.
 *
 * - `pathway` : elk `layered`, flux vers le bas, repli en colonnes si la chaîne est longue ;
 * - `stages`  : elk `layered`, étapes de gauche à droite, repli en lignes ;
 * - `cycle`   : positions circulaires fixées (sens horaire depuis midi), liens en arcs.
 */
import "server-only";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DiagramLayout, DiagramSpec, LayoutBox } from "@/lib/storyboard/types";
import { TITLE_FONT, TITLE_HEIGHT, CHAR_WIDTH, NODE_FONT, edgeKey, edgeLabelSize, nodeSize } from "./text";

/** Marge autour du schéma (unités du viewBox). */
export const LAYOUT_PADDING = 16;
/** Écart minimal entre deux boîtes (nœuds, étiquettes). */
export const BOX_GAP = 4;
/** Rapport largeur/hauteur visé : proche du panneau du lecteur (0,75 à 1). */
const ASPECT_RATIO = 0.85;

let elk: InstanceType<typeof ELK> | null = null;

export async function layoutDiagram(spec: DiagramSpec): Promise<DiagramLayout> {
  const raw = spec.template === "cycle" ? layoutCycle(spec) : await layoutLayered(spec);
  return finalize(spec, raw);
}

interface RawLayout {
  nodes: Record<string, LayoutBox>;
  edges: Record<string, { points: [number, number][]; label?: LayoutBox }>;
}

// ---------------------------------------------------------------------------
// pathway / stages : elk layered
// ---------------------------------------------------------------------------

async function layoutLayered(spec: DiagramSpec): Promise<RawLayout> {
  elk ??= new ELK();
  const down = spec.template === "pathway";
  const labelSizes = spec.edges.map((e) => (e.label ? edgeLabelSize(e.label) : null));
  const widest = Math.max(0, ...labelSizes.map((s) => s?.w ?? 0));
  const hasLabels = widest > 0;
  // Espace entre couches : assez pour loger l'étiquette d'un lien dans l'intervalle.
  const betweenLayers = !hasLabels ? 36 : down ? 58 : Math.max(58, widest + 24);

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": down ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.aspectRatio": String(ASPECT_RATIO),
      "elk.layered.wrapping.strategy": "MULTI_EDGE",
      "elk.layered.wrapping.additionalEdgeSpacing": "12",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(betweenLayers),
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "10",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: spec.nodes.map((n) => ({ id: n.id, ...size(nodeSize(n.label)) })),
    edges: spec.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const out = await elk.layout(graph);

  const nodes: RawLayout["nodes"] = {};
  for (const c of out.children ?? []) nodes[c.id] = { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 };

  const edges: RawLayout["edges"] = {};
  const placed: LayoutBox[] = [];
  spec.edges.forEach((e, i) => {
    const laid = out.edges?.find((x) => x.id === `e${i}`);
    const points: [number, number][] = [];
    for (const s of laid?.sections ?? []) {
      for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) {
        const last = points.at(-1);
        if (!last || last[0] !== p.x || last[1] !== p.y) points.push([p.x, p.y]);
      }
    }
    const labelSize = labelSizes[i];
    const label = labelSize ? placeLabel(labelSize, segmentCandidates(points), nodes, placed) : undefined;
    edges[edgeKey(e.from, e.to)] = { points, ...(label ? { label } : {}) };
  });
  return { nodes, edges };
}

/** Centres candidats d'une étiquette : milieu de chaque segment, du plus long au plus court. */
function segmentCandidates(points: [number, number][]): [number, number][] {
  const segs: { len: number; mid: [number, number] }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    segs.push({ len: Math.hypot(x1 - x0, y1 - y0), mid: [(x0 + x1) / 2, (y0 + y1) / 2] });
  }
  return segs.sort((a, b) => b.len - a.len).map((s) => s.mid);
}

// ---------------------------------------------------------------------------
// cycle : cercle, sens horaire depuis midi
// ---------------------------------------------------------------------------

const ARC_STEP = Math.PI / 90; // 2°

function layoutCycle(spec: DiagramSpec): RawLayout {
  const n = spec.nodes.length;
  const sizes = spec.nodes.map((node) => nodeSize(node.label));
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const boxesAt = (r: number) =>
    sizes.map((s, i) => ({ x: r * Math.cos(angle(i)) - s.w / 2, y: r * Math.sin(angle(i)) - s.h / 2, w: s.w, h: s.h }));

  // Plus petit rayon (par pas de 4) qui sépare toutes les boîtes d'au moins 24 unités.
  let r = Math.max(60, ...sizes.map((s) => s.h));
  for (; r < 2000; r += 4) {
    const boxes = boxesAt(r);
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = i + 1; j < n && ok; j++) ok = !overlaps(boxes[i], boxes[j], 24);
    if (ok) break;
  }
  const boxes = boxesAt(r);
  const nodes: RawLayout["nodes"] = {};
  spec.nodes.forEach((node, i) => (nodes[node.id] = boxes[i]));
  const index = new Map(spec.nodes.map((node, i) => [node.id, i]));

  const edges: RawLayout["edges"] = {};
  const placed: LayoutBox[] = [];
  for (const e of spec.edges) {
    const i = index.get(e.from)!;
    const j = index.get(e.to)!;
    const forward = (i + 1) % n === j;
    const backward = (j + 1) % n === i;
    let points: [number, number][];
    let candidates: [number, number][];
    const labelSize = e.label ? edgeLabelSize(e.label) : null;
    if (forward || backward) {
      // Arc entre les deux nœuds voisins, dans le sens du lien.
      const a0 = angle(i);
      let a1 = angle(j);
      if (forward && a1 <= a0) a1 += 2 * Math.PI;
      if (!forward && a1 >= a0) a1 -= 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
      points = [];
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        const p: [number, number] = [r * Math.cos(a), r * Math.sin(a)];
        if (!inside(p, boxes[i], 6) && !inside(p, boxes[j], 6)) points.push(p);
      }
      const mid = (a0 + a1) / 2;
      const off = labelSize ? Math.hypot(labelSize.w, labelSize.h) / 2 + 6 : 0;
      candidates = [r + off, r - off, r].map((rr) => [rr * Math.cos(mid), rr * Math.sin(mid)] as [number, number]);
    } else {
      // Raccourci à travers le cercle : segment entre les bords des deux boîtes.
      const c0 = center(boxes[i]);
      const c1 = center(boxes[j]);
      points = [clipToBox(c1, c0, boxes[i], 6), clipToBox(c0, c1, boxes[j], 6)];
      candidates = [[(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]];
    }
    const label = labelSize ? placeLabel(labelSize, candidates, nodes, placed) : undefined;
    edges[edgeKey(e.from, e.to)] = { points: points.length >= 2 ? points : [], ...(label ? { label } : {}) };
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

const size = (s: { w: number; h: number }) => ({ width: s.w, height: s.h });
const center = (b: LayoutBox): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

export function overlaps(a: LayoutBox, b: LayoutBox, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function inside([x, y]: [number, number], b: LayoutBox, margin: number): boolean {
  return x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin;
}

/** Point où le segment `from → to` (to = centre de `box`) entre dans `box` élargie de `margin`. */
function clipToBox(from: [number, number], to: [number, number], box: LayoutBox, margin: number): [number, number] {
  const [cx, cy] = to;
  const dx = from[0] - cx;
  const dy = from[1] - cy;
  const hw = box.w / 2 + margin;
  const hh = box.h / 2 + margin;
  const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
  return [cx + dx * k, cy + dy * k];
}

/** Première position candidate qui ne chevauche ni un nœud ni une étiquette déjà placée (sinon pas d'étiquette). */
function placeLabel(
  s: { w: number; h: number },
  candidates: [number, number][],
  nodes: Record<string, LayoutBox>,
  placed: LayoutBox[],
): LayoutBox | undefined {
  for (const [cx, cy] of candidates) {
    const box = { x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h };
    if (Object.values(nodes).some((n) => overlaps(box, n, BOX_GAP))) continue;
    if (placed.some((p) => overlaps(box, p, BOX_GAP))) continue;
    placed.push(box);
    return box;
  }
  return undefined;
}

/** Recadre à l'origine avec une marge, réserve le bandeau du titre et arrondit. */
function finalize(spec: DiagramSpec, raw: RawLayout): DiagramLayout {
  const boxes = [...Object.values(raw.nodes), ...Object.values(raw.edges).flatMap((e) => (e.label ? [e.label] : []))];
  const xs = [...boxes.flatMap((b) => [b.x, b.x + b.w]), ...Object.values(raw.edges).flatMap((e) => e.points.map((p) => p[0]))];
  const ys = [...boxes.flatMap((b) => [b.y, b.y + b.h]), ...Object.values(raw.edges).flatMap((e) => e.points.map((p) => p[1]))];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  let contentW = Math.max(...xs) - minX;
  const contentH = Math.max(...ys) - minY;

  const titleW = spec.title ? Math.ceil(spec.title.length * CHAR_WIDTH * (TITLE_FONT / NODE_FONT)) : 0;
  const top = spec.title ? TITLE_HEIGHT + 8 : 0;
  const extraX = Math.max(0, titleW - contentW) / 2;
  contentW = Math.max(contentW, titleW);

  const dx = LAYOUT_PADDING + extraX - minX;
  const dy = LAYOUT_PADDING + top - minY;
  const r = (v: number) => Math.round(v * 10) / 10;
  const move = (b: LayoutBox): LayoutBox => ({ x: r(b.x + dx), y: r(b.y + dy), w: r(b.w), h: r(b.h) });

  const width = r(contentW + 2 * LAYOUT_PADDING);
  return {
    width,
    height: r(contentH + top + 2 * LAYOUT_PADDING),
    nodes: Object.fromEntries(Object.entries(raw.nodes).map(([id, b]) => [id, move(b)])),
    edges: Object.fromEntries(
      Object.entries(raw.edges).map(([k, e]) => [
        k,
        {
          points: e.points.map(([x, y]) => [r(x + dx), r(y + dy)] as [number, number]),
          ...(e.label ? { label: move(e.label) } : {}),
        },
      ]),
    ),
    ...(spec.title ? { title: { x: LAYOUT_PADDING, y: LAYOUT_PADDING, w: r(contentW), h: TITLE_HEIGHT } } : {}),
  };
}
