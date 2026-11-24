/**
 * Capsules de démonstration du lecteur (phase 3), sans base ni IA : de vrais
 * scripts annotés passés dans `buildStoryboard()` (le même assemblage qu'en
 * production), un schéma de démonstration et un horodatage simulé calé sur un
 * MP3 muet de durée fixe (`public/demo/*.mp3`).
 */
import { buildStoryboard, type PreparedDiagram, type StoryboardDiagram } from "@/lib/episodes/storyboard";
import { toDiagramSpec } from "@/lib/diagrams/spec";
import type { EpisodeScript } from "@/lib/episodes/script";
import type { FeedItem } from "@/lib/feed/types";
import type { WordTimestamp } from "@/lib/storyboard/types";
import { toSsmlUnits } from "@/lib/tts/ssml";

const DIAGRAM: StoryboardDiagram = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "/demo/chaine-respiratoire.svg",
  width: 1200,
  height: 800,
};

/** Horodatage plausible (~2,7 mots/s, pauses en fin de phrase), mis à l'échelle de `durationMs`. */
export function simulateTimings(script: EpisodeScript, durationMs: number): WordTimestamp[] {
  const words = script.scenes.flatMap((s) => toSsmlUnits(s.narration).map((u) => u.word));
  const raw: WordTimestamp[] = [];
  let t = 250;
  for (const word of words) {
    const len = Math.min(650, Math.max(170, 110 + 42 * word.replace(/[^\p{L}\p{N}]/gu, "").length));
    raw.push({ word, startMs: t, endMs: t + len });
    t += len + 40 + (/[.!?…]$/.test(word) ? 380 : /[,;:]$/.test(word) ? 170 : 0);
  }
  const k = (durationMs - 600) / t;
  return raw.map((w) => ({ word: w.word, startMs: Math.round(w.startMs * k), endMs: Math.round(w.endMs * k) }));
}

const none = { diagramRef: null, camera: null, calloutLabel: null, highlightText: null, comparison: null };

/** Schéma généré de démonstration (phase 3.5) : structure seule, la mise en page est faite côté serveur. */
export const DEMO_GENERATED = [
  {
    ref: "G1",
    template: "cycle" as const,
    title: "Cycle de Krebs",
    nodes: [
      { id: "oaa", label: "Oxaloacétate", group: null },
      { id: "citrate", label: "Citrate", group: null },
      { id: "isocitrate", label: "Isocitrate", group: null },
      { id: "akg", label: "α-cétoglutarate", group: null },
      { id: "succoa", label: "Succinyl-CoA", group: null },
      { id: "succinate", label: "Succinate", group: null },
      { id: "fumarate", label: "Fumarate", group: null },
      { id: "malate", label: "Malate", group: null },
    ],
    edges: [
      { from: "oaa", to: "citrate", label: "+ acétyl-CoA" },
      { from: "citrate", to: "isocitrate", label: null },
      { from: "isocitrate", to: "akg", label: "CO₂" },
      { from: "akg", to: "succoa", label: "CO₂" },
      { from: "succoa", to: "succinate", label: null },
      { from: "succinate", to: "fumarate", label: null },
      { from: "fumarate", to: "malate", label: null },
      { from: "malate", to: "oaa", label: null },
    ],
  },
];

export const DEMO_GENERATED_SPECS = DEMO_GENERATED.map((d) => ({ ref: d.ref, spec: toDiagramSpec(d) }));

const CAPSULES: { id: string; chapter: string; durationMs: number; audio: string; script: EpisodeScript }[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    chapter: "Chapitre 3 · Métabolisme énergétique",
    durationMs: 44_000,
    audio: "/demo/capsule-1.mp3",
    script: {
      title: "La chaîne respiratoire",
      hookTitle: "D'où vient vraiment ton ATP ?",
      scenes: [
        {
          ...none,
          narration:
            "Tu respires pour une seule raison : fabriquer de l'[ATP|a té pé]. Et presque tout se joue dans une membrane de quelques nanomètres.",
          visualType: "kinetic_text",
          highlightText: "90 % de ton ATP",
        },
        {
          ...none,
          narration:
            "Voici la membrane interne de la mitochondrie. Le [NADH|N A D H] y dépose ses électrons sur le complexe [I|un], qui en profite pour pomper des protons vers l'espace intermembranaire.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1, toScale: 2.1, focusX: 18, focusY: 48 },
          calloutLabel: "Complexe I",
        },
        {
          ...none,
          narration:
            "Les électrons passent ensuite par l'ubiquinone, le complexe [III|trois], le cytochrome c, puis le complexe [IV|quatre]. À chaque étape, encore des protons pompés.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1.2, toScale: 1.9, focusX: 56, focusY: 42 },
          calloutLabel: "Complexes III et IV",
        },
        {
          ...none,
          narration:
            "Au bout de la chaîne, l'oxygène récupère les électrons et forme de l'eau. Sans [O₂|oxygène], tout s'arrête.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1.6, toScale: 2.3, focusX: 66, focusY: 84 },
          calloutLabel: "Accepteur final : O₂",
        },
        {
          ...none,
          narration:
            "Résultat : un gradient de protons. Ils redescendent par l'[ATP|a té pé] synthase, une véritable turbine, qui phosphoryle l'[ADP|a dé pé] en [ATP|a té pé].",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1.1, toScale: 2.2, focusX: 86, focusY: 58 },
          calloutLabel: "ATP synthase",
        },
      ],
      quiz: {
        question: "Quel est l'accepteur final des électrons de la chaîne respiratoire ?",
        choices: ["Le dioxygène", "Le NAD⁺", "L'ubiquinone", "Le cytochrome c"],
        correctIndex: 0,
        explanation: "Le complexe IV transfère les électrons à O₂, qui est réduit en H₂O : sans oxygène, la chaîne se bloque.",
      },
    },
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    chapter: "Chapitre 3 · Métabolisme énergétique",
    durationMs: 28_000,
    audio: "/demo/capsule-2.mp3",
    script: {
      title: "Respiration ou fermentation ?",
      hookTitle: "Pourquoi tes muscles brûlent au sprint",
      scenes: [
        {
          ...none,
          narration: "Quand l'oxygène manque, la cellule change de stratégie en quelques secondes.",
          visualType: "kinetic_text",
          highlightText: "Plan B : fermenter",
        },
        {
          ...none,
          narration:
            "Avec oxygène, la respiration rend environ [32 ATP|trente-deux a té pé] par glucose. Sans oxygène, la fermentation lactique n'en donne que [2|deux], mais immédiatement.",
          visualType: "comparison_card",
          comparison: {
            leftTitle: "Respiration",
            leftItems: ["Avec O₂", "≈ 32 ATP / glucose", "Mitochondrie", "Lente, rentable"],
            rightTitle: "Fermentation",
            rightItems: ["Sans O₂", "2 ATP / glucose", "Cytosol", "Rapide, coûteuse"],
          },
        },
        {
          ...none,
          narration:
            "La différence vient de la chaîne respiratoire : sans accepteur final, le gradient de protons ne se forme plus et la turbine s'arrête.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1, toScale: 1.6, focusX: 62, focusY: 50 },
          calloutLabel: "Chaîne à l'arrêt",
        },
        {
          ...none,
          narration: "Retiens le rapport : seize fois plus d'énergie quand l'oxygène est là.",
          visualType: "kinetic_text",
          highlightText: "× 16",
        },
      ],
      quiz: {
        question: "Combien d'ATP la fermentation lactique produit-elle par glucose ?",
        choices: ["2", "4", "32", "38"],
        correctIndex: 0,
        explanation: "Seule la glycolyse produit de l'ATP pendant la fermentation : 2 ATP nets par glucose.",
      },
    },
  },
  {
    id: "00000000-0000-4000-8000-0000000000a3",
    chapter: "Chapitre 3 · Métabolisme énergétique",
    durationMs: 21_000,
    audio: "/demo/capsule-3.mp3",
    script: {
      title: "Le gradient de protons",
      hookTitle: "Une batterie dans chaque mitochondrie",
      scenes: [
        {
          ...none,
          narration: "Imagine un barrage hydraulique, mais à l'échelle moléculaire.",
          visualType: "kinetic_text",
          highlightText: "Force proton-motrice",
        },
        {
          ...none,
          narration:
            "Les complexes [I|un], [III|trois] et [IV|quatre] accumulent les protons au-dessus de la membrane : c'est le réservoir.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1, toScale: 1.5, focusX: 50, focusY: 22 },
          calloutLabel: "Réservoir de H⁺",
        },
        {
          ...none,
          narration: "La seule sortie, c'est l'[ATP|a té pé] synthase : le flux de protons fait tourner son rotor.",
          visualType: "diagram",
          diagramRef: "S1",
          camera: { fromScale: 1.3, toScale: 2.4, focusX: 86, focusY: 55 },
          calloutLabel: "Le rotor",
        },
        {
          ...none,
          narration: "Un gradient, une turbine, de l'énergie : voilà la chimiosmose.",
          visualType: "kinetic_text",
          highlightText: "Chimiosmose",
        },
      ],
      quiz: {
        question: "Par où les protons regagnent-ils la matrice ?",
        choices: ["Par l'ATP synthase", "Par le complexe I", "Par diffusion libre", "Par le cytochrome c"],
        correctIndex: 0,
        explanation: "La membrane interne est imperméable aux H⁺ : ils ne redescendent que par le canal F₀ de l'ATP synthase.",
      },
    },
  },
  {
    id: "00000000-0000-4000-8000-0000000000a4",
    chapter: "Chapitre 3 · Métabolisme énergétique",
    durationMs: 28_000,
    audio: "/demo/capsule-2.mp3",
    script: {
      title: "Le cycle de Krebs",
      hookTitle: "Huit étapes, un seul tour",
      generatedDiagrams: DEMO_GENERATED,
      scenes: [
        {
          ...none,
          narration: "Huit réactions, une seule boucle. Bienvenue dans le cycle de Krebs !",
          visualType: "kinetic_text",
          highlightText: "Cycle de Krebs",
        },
        {
          ...none,
          narration: "L'oxaloacétate capte l'acétyl-CoA et forme le citrate, aussitôt transformé en isocitrate.",
          visualType: "generated_diagram",
          generatedDiagramRef: "G1",
          focusNodeId: null,
        },
        {
          ...none,
          narration: "Viennent deux décarboxylations : l'α-cétoglutarate, puis le succinyl-CoA. Le [CO₂|cé o deux] part ici.",
          visualType: "generated_diagram",
          generatedDiagramRef: "G1",
          focusNodeId: "akg",
        },
        {
          ...none,
          narration: "Le succinate devient fumarate, puis malate, et l'oxaloacétate est régénéré.",
          visualType: "generated_diagram",
          generatedDiagramRef: "G1",
          focusNodeId: "malate",
        },
        {
          ...none,
          narration: "Retiens : chaque tour libère deux [CO₂|cé o deux] et recharge trois [NADH|ène a dé ache].",
          visualType: "kinetic_text",
          highlightText: "2 CO₂ · 3 NADH",
        },
      ],
      quiz: {
        question: "Quelle molécule est régénérée à la fin de chaque tour du cycle de Krebs ?",
        choices: ["L'oxaloacétate", "Le citrate", "L'acétyl-CoA", "Le pyruvate"],
        correctIndex: 0,
        explanation: "Le malate est oxydé en oxaloacétate, qui peut capter un nouvel acétyl-CoA : la boucle est bouclée.",
      },
    },
  },
];

/**
 * `generated` : schémas générés déjà mis en page (`demo-diagrams.ts`, côté
 * serveur). Sans eux, leurs scènes passent en texte animé, comme en production.
 */
export function demoFeed(generated?: Map<string, PreparedDiagram>): FeedItem[] {
  return CAPSULES.map((c) => ({
    episodeId: c.id,
    title: c.script.title,
    courseTitle: "UE 1 · Biochimie (démo)",
    chapterTitle: c.chapter,
    progress: null,
    storyboard: buildStoryboard({
      script: c.script,
      diagrams: new Map([["S1", DIAGRAM]]),
      generatedDiagrams: generated,
      wordTimings: simulateTimings(c.script, c.durationMs),
      durationMs: c.durationMs,
      audioUrl: c.audio,
      audioMimeType: "audio/mpeg",
      seed: c.id,
    }),
  }));
}
