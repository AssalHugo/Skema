import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidElement, type ReactNode } from "react";
import { DEMO_GENERATED_SPECS, demoFeed } from "@/app/demo/demo-data";
import { GeneratedDiagram } from "@/components/player/GeneratedDiagram";
import { EpisodeScript, annotatedScript } from "@/lib/episodes/script";
import { buildStoryboard, focusCamera, type PreparedDiagram } from "@/lib/episodes/storyboard";
import {
  cameraFrameAt,
  cameraPlans,
  cameraViewBox,
  diagramKey,
  diagramPanelRatio,
  findGeneratedDiagram,
  renderKey,
  revealProgress,
  REVEAL_FADE_MS,
} from "@/lib/player/timeline";
import type { DiagramLayout, DiagramSpec, GeneratedStoryboard, LayoutBox, WordTimestamp } from "@/lib/storyboard/types";
import { toSsmlUnits } from "@/lib/tts/ssml";
import { fidelityVerdict } from "./fidelity";
import { layoutDiagram, overlaps } from "./layout";
import { REVEAL_LEAD_MS, computeReveal, labelTokens, normalizeToken } from "./reveal";
import { diagramSpecIssues, toDiagramSpec, type DiagramSpecInput } from "./spec";
import { edgeKey, nodeSize, wrapLabel } from "./text";

// ---------------------------------------------------------------------------
// Jeux de données
// ---------------------------------------------------------------------------

const pathway: DiagramSpec = {
  template: "pathway",
  title: "Glycolyse (phase préparatoire)",
  nodes: [
    { id: "glc", label: "Glucose", group: "substrat" },
    { id: "g6p", label: "Glucose-6-phosphate", group: "substrat" },
    { id: "f6p", label: "Fructose-6-phosphate", group: "substrat" },
    { id: "f16bp", label: "Fructose-1,6-bisphosphate", group: "substrat" },
    { id: "dhap", label: "DHAP", group: "substrat" },
    { id: "g3p", label: "Glycéraldéhyde-3-phosphate", group: "substrat" },
    { id: "bpg", label: "1,3-bisphosphoglycérate", group: "substrat" },
    { id: "pg3", label: "3-phosphoglycérate", group: "substrat" },
    { id: "pg2", label: "2-phosphoglycérate", group: "substrat" },
    { id: "pep", label: "Phosphoénolpyruvate", group: "substrat" },
    { id: "pyr", label: "Pyruvate", group: "produit" },
    { id: "atp", label: "ATP", group: "énergie" },
  ],
  edges: [
    { from: "glc", to: "g6p", label: "hexokinase" },
    { from: "g6p", to: "f6p" },
    { from: "f6p", to: "f16bp", label: "PFK-1" },
    { from: "f16bp", to: "dhap" },
    { from: "f16bp", to: "g3p" },
    { from: "dhap", to: "g3p" },
    { from: "g3p", to: "bpg" },
    { from: "bpg", to: "pg3" },
    { from: "pg3", to: "pg2" },
    { from: "pg2", to: "pep" },
    { from: "pep", to: "pyr", label: "pyruvate kinase" },
    { from: "pep", to: "atp" },
  ],
};

const stages: DiagramSpec = {
  template: "stages",
  nodes: ["Prophase", "Prométaphase", "Métaphase", "Anaphase", "Télophase", "Cytodiérèse"].map((label, i) => ({ id: `p${i}`, label })),
  edges: [0, 1, 2, 3, 4].map((i) => ({ from: `p${i}`, to: `p${i + 1}`, ...(i === 2 ? { label: "séparation" } : {}) })),
};

const cycle2: DiagramSpec = {
  template: "cycle",
  nodes: [
    { id: "a", label: "Interphase" },
    { id: "b", label: "Mitose" },
  ],
  edges: [
    { from: "a", to: "b", label: "point G2/M" },
    { from: "b", to: "a" },
  ],
};

const krebs = DEMO_GENERATED_SPECS[0].spec;

function boxesOf(layout: DiagramLayout): { name: string; box: LayoutBox }[] {
  return [
    ...Object.entries(layout.nodes).map(([id, box]) => ({ name: `nœud ${id}`, box })),
    ...Object.entries(layout.edges).flatMap(([k, e]) => (e.label ? [{ name: `étiquette ${k}`, box: e.label }] : [])),
    ...(layout.title ? [{ name: "titre", box: layout.title }] : []),
  ];
}

// ---------------------------------------------------------------------------

describe("texte des schémas", () => {
  it("découpe les libellés en lignes de 16 caractères au plus", () => {
    assert.deepEqual(wrapLabel("Glycéraldéhyde-3-phosphate"), ["Glycéraldéhyde-3", "-phosphate"]);
    assert.deepEqual(wrapLabel("Complexe I de la chaîne"), ["Complexe I de la", "chaîne"]);
    assert.deepEqual(wrapLabel("ATP"), ["ATP"]);
    for (const label of ["a".repeat(40), "mot ".repeat(10).trim()]) {
      assert.ok(wrapLabel(label).length <= 3, label);
      assert.ok(wrapLabel(label).every((l) => l.length <= 16));
    }
  });

  it("dimensionne une boîte par ligne", () => {
    assert.ok(nodeSize("Fructose-1,6-bisphosphate").h > nodeSize("ATP").h);
    assert.ok(nodeSize("ATP").w >= 84);
  });
});

describe("mise en page (elkjs)", () => {
  for (const [name, spec] of [
    ["pathway (12 nœuds, branches, étiquettes)", pathway],
    ["stages (6 étapes)", stages],
    ["cycle (Krebs, 8 nœuds)", krebs],
    ["cycle (2 nœuds)", cycle2],
  ] as const) {
    it(`${name} : aucune boîte ne se chevauche, tout tient dans le viewBox`, async () => {
      const layout = await layoutDiagram(spec);
      const boxes = boxesOf(layout);
      assert.equal(Object.keys(layout.nodes).length, spec.nodes.length);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i].box;
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= layout.width + 0.1 && b.y + b.h <= layout.height + 0.1, `${boxes[i].name} hors cadre`);
        for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(!overlaps(b, boxes[j].box), `${boxes[i].name} chevauche ${boxes[j].name}`);
        }
      }
      for (const e of spec.edges) {
        const geo = layout.edges[edgeKey(e.from, e.to)];
        assert.ok(geo && geo.points.length >= 2, `lien ${e.from} → ${e.to} sans tracé`);
        for (const [x, y] of geo.points) assert.ok(x >= 0 && y >= 0 && x <= layout.width && y <= layout.height);
      }
      // Lisible à 390 px : en vue d'ensemble, le schéma garde un format proche du panneau.
      const ratio = layout.width / layout.height;
      assert.ok(ratio > 0.4 && ratio < 2.6, `format ${ratio.toFixed(2)}`);
    });
  }

  it("est déterministe", async () => {
    assert.deepEqual(await layoutDiagram(pathway), await layoutDiagram(pathway));
  });

  it("cycle : nœuds dans l'ordre horaire depuis midi", async () => {
    const layout = await layoutDiagram(krebs);
    const c = (id: string) => [layout.nodes[id].x + layout.nodes[id].w / 2, layout.nodes[id].y + layout.nodes[id].h / 2];
    const [x0, y0] = c("oaa");
    const [x2, y2] = c("isocitrate");
    const [, y4] = c("succoa");
    assert.ok(y0 < y2 && x2 > x0, "le 3e nœud est à droite");
    assert.ok(y4 > y2, "le 5e nœud est en bas");
    assert.ok(Object.values(layout.edges).filter((e) => e.label).length >= 2, "étiquettes CO₂ placées");
  });
});

describe("instants d'apparition", () => {
  const spec: DiagramSpec = {
    template: "pathway",
    nodes: [
      { id: "a", label: "Glucose" },
      { id: "b", label: "Glucose-6-phosphate" },
      { id: "c", label: "Introuvable" },
      { id: "d", label: "ATP" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "c", to: "d" },
    ],
  };
  const words = ["Le", "glucose", "devient", "glucose-6-phosphate,", "puis", "donne", "de", "l'ATP."];
  const wt: WordTimestamp[] = words.map((word, i) => ({ word, startMs: 1000 + i * 500, endMs: 1400 + i * 500 }));
  const scene = { startMs: 900, endMs: 5000, startWord: 0, endWord: words.length };

  it("normalise casse, accents, élision et ponctuation", () => {
    assert.equal(normalizeToken("l'ATP."), "atp");
    assert.equal(normalizeToken("Élision’"), "elision");
    assert.equal(normalizeToken("d’[ADN|a dé ène]"), "adn");
    assert.deepEqual(labelTokens("α-cétoglutarate"), ["α", "cetoglutarate"]);
  });

  it("cale chaque nœud sur son mot, un lien sur le dernier de ses nœuds", () => {
    const r = computeReveal(spec, [scene], wt);
    assert.equal(r.nodes.a, 1500 - REVEAL_LEAD_MS);
    assert.equal(r.nodes.b, 2500 - REVEAL_LEAD_MS);
    assert.equal(r.nodes.d, 4500 - REVEAL_LEAD_MS);
    assert.equal(r.edges[edgeKey("a", "b")], r.nodes.b);
    assert.equal(r.edges[edgeKey("c", "d")], Math.max(r.nodes.c, r.nodes.d));
  });

  it("repli déterministe et monotone quand un libellé est introuvable", () => {
    const r = computeReveal(spec, [scene], wt);
    // Seul « c » manque : 1re position uniforme = début de scène, relevée au nœud précédent placé.
    assert.ok(r.nodes.c >= r.nodes.b && r.nodes.c <= r.nodes.d, JSON.stringify(r.nodes));
    assert.deepEqual(computeReveal(spec, [scene], wt), r);

    const none = computeReveal(spec, [scene], wt.map((w) => ({ ...w, word: "rien" })));
    assert.deepEqual(Object.values(none.nodes), [900, 1925, 2950, 3975]);
  });

  it("cherche aussi dans les scènes suivantes du même schéma", () => {
    const s1 = { startMs: 900, endMs: 2000, startWord: 0, endWord: 2 };
    const s2 = { startMs: 2000, endMs: 5000, startWord: 2, endWord: words.length };
    const r = computeReveal(spec, [s1, s2], wt);
    assert.equal(r.nodes.a, 1500 - REVEAL_LEAD_MS);
    assert.equal(r.nodes.d, 4500 - REVEAL_LEAD_MS);
  });
});

describe("validation des schémas proposés", () => {
  const input: DiagramSpecInput = {
    ref: "g1",
    template: "pathway",
    title: null,
    nodes: [
      { id: "a", label: "[ATP|a té pé]", group: null },
      { id: "b", label: "ADP", group: "Énergie" },
    ],
    edges: [{ from: "a", to: "b", label: null }],
  };

  it("accepte un schéma cohérent et résout les annotations", () => {
    assert.deepEqual(diagramSpecIssues(input), []);
    const spec = toDiagramSpec(input);
    assert.equal(spec.nodes[0].label, "ATP");
    assert.equal(spec.nodes[1].group, "énergie");
    assert.equal(spec.title, undefined);
  });

  it("refuse liens vers un id inconnu, doublons, boucles, libellés trop longs", () => {
    const bad: DiagramSpecInput = {
      ...input,
      nodes: [...input.nodes, { id: "a", label: "x".repeat(41), group: null }],
      edges: [
        { from: "a", to: "z", label: null },
        { from: "b", to: "b", label: null },
        { from: "a", to: "b", label: null },
        { from: "a", to: "b", label: null },
      ],
    };
    const issues = diagramSpecIssues(bad).join(" | ");
    assert.match(issues, /en double : a/);
    assert.match(issues, /trop long/);
    assert.match(issues, /nœud inconnu/);
    assert.match(issues, /boucle/);
    assert.match(issues, /lien en double/);
  });

  it("le script refuse une scène vers un schéma non déclaré ou un focus inconnu", () => {
    const base = demoScript();
    assert.ok(EpisodeScript.safeParse(base).success, JSON.stringify(EpisodeScript.safeParse(base).error?.issues));
    const undeclared = { ...base, generatedDiagrams: [] };
    assert.ok(!EpisodeScript.safeParse(undeclared).success);
    const badFocus = { ...base, scenes: base.scenes.map((s) => (s.focusNodeId ? { ...s, focusNodeId: "zzz" } : s)) };
    assert.ok(!EpisodeScript.safeParse(badFocus).success);
    const tooMany = {
      ...base,
      generatedDiagrams: [{ ...base.generatedDiagrams![0], nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, group: null })) }],
    };
    assert.ok(!EpisodeScript.safeParse(tooMany).success);
  });
});

describe("vérification de fidélité", () => {
  it("un élément non attesté ou absent du rapport fait refuser le schéma", () => {
    const ok = fidelityVerdict(cycle2, {
      ref: "G1",
      nodes: [
        { id: "a", attested: true, evidence: "interphase" },
        { id: "b", attested: true, evidence: "mitose" },
      ],
      edges: [
        { from: "a", to: "b", attested: true, evidence: null },
        { from: "b", to: "a", attested: true, evidence: null },
      ],
    });
    assert.equal(ok.ok, true);
    const ko = fidelityVerdict(cycle2, {
      ref: "G1",
      nodes: [{ id: "a", attested: true, evidence: null }],
      edges: [{ from: "a", to: "b", attested: false, evidence: null }],
    });
    assert.deepEqual(ko, { ok: false, unsupportedNodes: ["b"], unsupportedEdges: ["a->b", "b->a"] });
    assert.equal(fidelityVerdict(cycle2, undefined).ok, false);
  });
});

// ---------------------------------------------------------------------------
// Storyboard 1.2 et lecteur
// ---------------------------------------------------------------------------

function demoScript(): EpisodeScript {
  return krebsScript;
}

const krebsScript: EpisodeScript = (() => {
  const none = { diagramRef: null, camera: null, calloutLabel: null, highlightText: null, comparison: null };
  const fill = (n: number) => Array(n).fill("Les étudiants révisent ce passage du cours avec attention avant leur examen final.").join(" ");
  return {
    title: "Le cycle de Krebs",
    hookTitle: "Huit étapes",
    generatedDiagrams: [
      {
        ref: "G1",
        template: "cycle",
        title: null,
        nodes: krebs.nodes.map((n) => ({ id: n.id, label: n.label, group: null })),
        edges: krebs.edges.map((e) => ({ from: e.from, to: e.to, label: e.label ?? null })),
      },
    ],
    scenes: [
      { ...none, narration: `Huit réactions, une seule boucle. ${fill(4)}`, visualType: "kinetic_text", highlightText: "Krebs" },
      {
        ...none,
        narration: `L'oxaloacétate forme le citrate puis l'isocitrate. ${fill(3)}`,
        visualType: "generated_diagram",
        generatedDiagramRef: "g1",
        focusNodeId: null,
      },
      {
        ...none,
        narration: `Puis l'α-cétoglutarate et le succinyl-CoA. ${fill(3)}`,
        visualType: "generated_diagram",
        generatedDiagramRef: "G1",
        focusNodeId: "akg",
      },
      {
        ...none,
        narration: `Succinate, fumarate, malate. ${fill(3)}`,
        visualType: "generated_diagram",
        generatedDiagramRef: "G1",
        focusNodeId: "malate",
      },
    ],
    quiz: { question: "Q ?", choices: ["a", "b", "c", "d"], correctIndex: 0, explanation: "E." },
  };
})();

function timings(script: EpisodeScript, msPerWord = 300): WordTimestamp[] {
  return toSsmlUnits(annotatedScript(script.scenes)).map((u, i) => ({ word: u.word, startMs: i * msPerWord, endMs: (i + 1) * msPerWord - 40 }));
}

async function prepared(): Promise<Map<string, PreparedDiagram>> {
  return new Map([["G1", { spec: krebs, layout: await layoutDiagram(krebs) }]]);
}

function build(generated: Map<string, PreparedDiagram> | undefined): GeneratedStoryboard {
  const wt = timings(krebsScript);
  return buildStoryboard({
    script: krebsScript,
    diagrams: new Map(),
    generatedDiagrams: generated,
    wordTimings: wt,
    durationMs: wt.length * 300 + 200,
    audioUrl: "/a.mp3",
    audioMimeType: "audio/mpeg",
    seed: "ep",
  });
}

/** Sérialisation stable d'un arbre d'éléments React (composant appelé comme une fonction pure). */
function serialize(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.map(serialize);
  if (!isValidElement(node)) return node ?? null;
  const { children, ...props } = node.props as Record<string, unknown> & { children?: ReactNode };
  return { type: typeof node.type === "string" ? node.type : "component", key: node.key, props, children: serialize(children) };
}

describe("storyboard 1.2", () => {
  it("déclare le schéma une fois, le référence dans les scènes et cadre le nœud ciblé", async () => {
    const sb = build(await prepared());
    assert.equal(sb.version, "1.2");
    assert.equal(sb.generatedDiagrams?.length, 1);
    const g = sb.generatedDiagrams![0];
    const scenes = sb.scenes.filter((s) => s.visualType === "generated_diagram");
    assert.equal(scenes.length, 3);
    assert.ok(scenes.every((s) => s.generatedDiagramId === "G1" && s.diagramWidth === g.layout.width));
    assert.equal(scenes[0].focusNodeId, undefined);
    assert.deepEqual(scenes[0].cameraMotion, { fromScale: 1, toScale: 1, focusX: 50, focusY: 50 });
    assert.equal(scenes[1].focusNodeId, "akg");
    assert.deepEqual(scenes[1].cameraMotion, focusCamera(g.layout, "akg"));
    assert.ok(scenes[1].cameraMotion!.toScale > 1);
    // Apparitions calées sur la voix-off : citrate (scène 2) avant succinyl-CoA (scène 3).
    assert.ok(g.reveal.nodes.citrate >= scenes[0].startMs && g.reveal.nodes.citrate < scenes[1].startMs);
    assert.ok(g.reveal.nodes.succoa >= scenes[1].startMs && g.reveal.nodes.succoa < scenes[2].startMs);
    assert.ok(g.reveal.nodes.malate >= scenes[2].startMs);
    assert.ok(JSON.parse(JSON.stringify(sb)), "sérialisable en JSON (storyboard_json)");
  });

  it("schéma refusé par la vérification de fidélité → texte animé, storyboard 1.1", () => {
    const sb = build(undefined);
    assert.equal(sb.version, "1.1");
    assert.equal(sb.generatedDiagrams, undefined);
    assert.ok(sb.scenes.every((s) => s.visualType === "kinetic_text" && s.highlightText));
  });

  it("caméra continue entre scènes consécutives du même schéma généré", async () => {
    const sb = build(await prepared());
    const plans = cameraPlans(sb.scenes);
    const [i, j] = [2, 3];
    assert.equal(diagramKey(sb.scenes[i]), "generated:G1");
    assert.equal(plans[i]!.oversample, 1);
    assert.deepEqual(plans[j]!.from, cameraFrameAt(sb.scenes[i], plans[i]!, sb.scenes[i].endMs));
  });

  it("viewBox : vue d'ensemble = panneau entier, zoom = nœud au centre", async () => {
    const layout = await layoutDiagram(krebs);
    const ratio = diagramPanelRatio(layout.width, layout.height);
    const [x, y, w, h] = cameraViewBox({ scale: 1, translateX: 0, translateY: 0 }, layout).split(" ").map(Number);
    assert.ok(Math.abs(w / h - ratio) < 0.01);
    assert.ok(Math.abs(x + w / 2 - layout.width / 2) < 0.01 && Math.abs(y + h / 2 - layout.height / 2) < 0.01);
    assert.ok(w >= layout.width - 0.01 && h >= layout.height - 0.01);

    const sb = build(await prepared());
    const scene = sb.scenes[2];
    const plan = cameraPlans(sb.scenes)[2]!;
    const [zx, zy, zw, zh] = cameraViewBox(cameraFrameAt(scene, plan, scene.endMs), layout).split(" ").map(Number);
    const node = layout.nodes.akg;
    assert.ok(zw < w, "zoomé");
    // Le nœud ciblé est visible (cadrage borné aux bords du schéma : pas forcément au centre exact).
    assert.ok(node.x >= zx - 1 && node.x + node.w <= zx + zw + 1 && node.y >= zy - 1 && node.y + node.h <= zy + zh + 1);
  });

  it("rendu pur : même (diagram, frame, tMs) → même SVG, en lecture continue comme par saut", async () => {
    const sb = build(await prepared());
    const diagram = sb.generatedDiagrams![0];
    const scene = sb.scenes[2];
    const plan = cameraPlans(sb.scenes)[2]!;
    const target = Math.round((scene.startMs + scene.endMs) / 2);
    const render = (t: number) =>
      JSON.stringify(serialize(GeneratedDiagram({ diagram, tMs: t, frame: cameraFrameAt(scene, plan, t), focusNodeId: scene.focusNodeId })));
    let continuous = "";
    for (let t = scene.startMs; t <= target; t += 16) continuous = render(t);
    continuous = render(target);
    assert.equal(render(target), continuous);
    assert.equal(render(target), render(target));
    assert.notEqual(render(scene.startMs), render(sb.totalDurationMs), "les apparitions évoluent avec le temps");
  });

  it("apparitions : fondu de 250 ms, re-rendu React par paliers", async () => {
    const sb = build(await prepared());
    const r = sb.generatedDiagrams![0].reveal.nodes.citrate;
    assert.equal(revealProgress(r, r - 1), 0);
    assert.equal(revealProgress(r, r + REVEAL_FADE_MS), 1);
    assert.ok(revealProgress(r, r + REVEAL_FADE_MS / 2) > 0.4);
    assert.notEqual(renderKey(sb, r + 10), renderKey(sb, r + REVEAL_FADE_MS / 2));
  });
});

describe("rétrocompatibilité 1.1", () => {
  it("le lecteur 1.2 lit une capsule 1.1 déjà en base", () => {
    const legacy = demoFeed()[0].storyboard;
    // Capsule 1.1 telle que stockée en phase 2 (aucun champ 1.2).
    const stored = JSON.parse(JSON.stringify({ ...legacy, version: "1.1" })) as GeneratedStoryboard;
    assert.equal(stored.generatedDiagrams, undefined);
    const plans = cameraPlans(stored.scenes);
    assert.equal(plans.length, stored.scenes.length);
    assert.ok(plans.some((p) => p && p.oversample > 1), "caméra des WebP inchangée");
    for (const s of stored.scenes) assert.equal(findGeneratedDiagram(stored.generatedDiagrams, s.generatedDiagramId), undefined);
    assert.match(renderKey(stored, 1000), /^\d+\|[01]\|\d+\|\d+\|[01]$/);
  });

  it("la démo produit une capsule 1.2 quand les schémas sont mis en page, 1.1 sinon", async () => {
    const withLayouts = new Map(
      await Promise.all(DEMO_GENERATED_SPECS.map(async ({ ref, spec }) => [ref, { spec, layout: await layoutDiagram(spec) }] as const)),
    );
    const krebsItem = demoFeed(withLayouts).find((i) => i.title === "Le cycle de Krebs")!;
    assert.equal(krebsItem.storyboard.version, "1.2");
    assert.equal(krebsItem.storyboard.scenes.filter((s) => s.visualType === "generated_diagram").length, 3);
    assert.equal(demoFeed().find((i) => i.title === "Le cycle de Krebs")!.storyboard.version, "1.1");
    // Tous les libellés du schéma sont retrouvés dans la narration simulée.
    const g = krebsItem.storyboard.generatedDiagrams![0];
    const first = krebsItem.storyboard.scenes.find((s) => s.visualType === "generated_diagram")!;
    assert.ok(Object.values(g.reveal.nodes).every((t) => t >= first.startMs));
  });
});
