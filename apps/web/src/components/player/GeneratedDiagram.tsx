import type { Ref } from "react";
import { EDGE_FONT, NODE_FONT, NODE_LINE_HEIGHT, NODE_PAD_Y, TITLE_FONT, edgeKey, wrapLabel } from "@/lib/diagrams/text";
import { type CameraFrame, cameraViewBox, revealProgress } from "@/lib/player/timeline";
import type { GeneratedDiagram as Diagram } from "@/lib/storyboard/types";

/** Couleurs des groupes, dans l'ordre de première apparition (le premier = accent). */
export const GROUP_COLORS = ["#34d399", "#7dd3fc", "#fbbf24", "#f472b6", "#a78bfa"] as const;
export const DIAGRAM_BACKGROUND = "#0f1a17";

const OVERVIEW: CameraFrame = { scale: 1, translateX: 0, translateY: 0 };

/** Couleur de chaque nœud selon son groupe. */
export function nodeColors(diagram: Pick<Diagram, "spec">): Record<string, string> {
  const groups: string[] = [];
  const out: Record<string, string> = {};
  for (const n of diagram.spec.nodes) {
    const g = n.group ?? "";
    let i = groups.indexOf(g);
    if (i < 0) i = groups.push(g) - 1;
    out[n.id] = GROUP_COLORS[i % GROUP_COLORS.length];
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Schéma 2D généré, fonction PURE de `(diagram, frame, tMs)` : synchrone, sans
 * état ni animation déclarative, sans elkjs (mise en page déjà calculée côté
 * serveur). La même entrée donne toujours le même SVG, que `tMs` soit atteint
 * en lecture continue ou par un saut — et le composant peut être enveloppé tel
 * quel dans une composition Remotion pour un export MP4.
 *
 * - caméra : `viewBox` (vectoriel, net à tout zoom) ; le lecteur le repeint
 *   aussi à chaque image via `svgRef`, hors rendu React ;
 * - apparitions : opacité et tracé = fonctions de `tMs - reveal`.
 */
export function GeneratedDiagram({
  diagram,
  tMs,
  frame = OVERVIEW,
  focusNodeId,
  svgRef,
  idPrefix = "gd",
}: {
  diagram: Diagram;
  tMs: number;
  frame?: CameraFrame;
  focusNodeId?: string;
  svgRef?: Ref<SVGSVGElement>;
  /** Préfixe des `id` SVG internes (flèches), unique par instance affichée. */
  idPrefix?: string;
}) {
  const { spec, layout, reveal } = diagram;
  const colors = nodeColors(diagram);
  const arrowId = `${idPrefix}-arrow`;

  return (
    <svg
      ref={svgRef}
      viewBox={cameraViewBox(frame, layout)}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label={spec.title ?? spec.nodes.map((n) => n.label).join(", ")}
      className="block select-none"
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
    >
      <defs>
        <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.75)" />
        </marker>
      </defs>

      {layout.title && spec.title && (
        <text
          x={layout.title.x + layout.title.w / 2}
          y={layout.title.y + layout.title.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={TITLE_FONT}
          fontWeight={800}
          fill="#34d399"
          letterSpacing="0.04em"
        >
          {spec.title.toUpperCase()}
        </text>
      )}

      {/* Liens sous les nœuds : tracé progressif, flèche une fois le tracé terminé. */}
      {spec.edges.map((e) => {
        const key = edgeKey(e.from, e.to);
        const geo = layout.edges[key];
        if (!geo || geo.points.length < 2) return null;
        const p = revealProgress(reveal.edges[key], tMs);
        if (p <= 0) return null;
        const d = geo.points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
        return (
          <g key={key} opacity={r2(Math.min(1, p * 2))}>
            <path
              d={d}
              pathLength={1}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray="1 1"
              strokeDashoffset={r2(1 - p)}
              markerEnd={p >= 1 ? `url(#${arrowId})` : undefined}
            />
            {geo.label && e.label && (
              <g opacity={r2(p)}>
                <rect x={geo.label.x} y={geo.label.y} width={geo.label.w} height={geo.label.h} rx={6} fill={DIAGRAM_BACKGROUND} stroke="rgba(255,255,255,0.18)" />
                <text
                  x={geo.label.x + geo.label.w / 2}
                  y={geo.label.y + geo.label.h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={EDGE_FONT}
                  fontStyle="italic"
                  fill="rgba(255,255,255,0.8)"
                >
                  {e.label}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {spec.nodes.map((n) => {
        const box = layout.nodes[n.id];
        if (!box) return null;
        const p = revealProgress(reveal.nodes[n.id], tMs);
        if (p <= 0) return null;
        const color = colors[n.id];
        const focused = n.id === focusNodeId;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const s = 0.85 + 0.15 * p;
        return (
          <g key={n.id} opacity={r2(p)} transform={`translate(${cx} ${cy}) scale(${r2(s)}) translate(${-cx} ${-cy})`}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={12}
              fill={`${color}${focused ? "40" : "1f"}`}
              stroke={color}
              strokeWidth={focused ? 3 : 1.5}
            />
            <text textAnchor="middle" fontSize={NODE_FONT} fontWeight={700} fill="#ffffff">
              {wrapLabel(n.label).map((line, i) => (
                <tspan key={i} x={cx} y={box.y + NODE_PAD_Y + NODE_LINE_HEIGHT * (i + 0.5)} dominantBaseline="central">
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
