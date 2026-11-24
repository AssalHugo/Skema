/**
 * Contrat `storyboard_json` des capsules générées (moteur 2), consommé par le
 * lecteur Live Web Rendering (phase 3). Sans dépendance serveur : importable
 * par les composants client.
 *
 * Version 1.1 = contrat d'origine (`Architecture PWA Révision Vidéo IA.md`)
 * complété par `displaySegments`, `ssmlWithSub` et `quiz` (plan, phase 2).
 * Version 1.2 (phase 3.5) = 1.1 + schémas 2D générés (`generatedDiagrams`,
 * `generated_diagram`). Tous les champs ajoutés sont optionnels : une capsule
 * 1.1 reste lisible telle quelle.
 */

/** Un mot AFFICHÉ (écriture scientifique exacte : « ATP », « 37 °C »). */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

/** Ligne de sous-titres : quelques mots, coupée en fin de phrase ou de proposition. */
export interface DisplaySegment {
  text: string;
  /** Index du premier mot dans `wordTimings` (inclus). */
  startWord: number;
  /** Index du dernier mot + 1 (exclu). */
  endWord: number;
  startMs: number;
  endMs: number;
  sceneIndex: number;
}

export type VisualType = "diagram" | "generated_diagram" | "kinetic_text" | "comparison_card";

// ---------------------------------------------------------------------------
// Schémas 2D générés (phase 3.5) : le LLM fournit la structure, le serveur la
// mise en page (elkjs) et les instants d'apparition, le lecteur un SVG pur.
// ---------------------------------------------------------------------------

export type DiagramTemplate = "pathway" | "cycle" | "stages";

export interface DiagramNode {
  id: string;
  label: string;
  group?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  template: DiagramTemplate;
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Calculé côté serveur par elkjs, dans le repère du viewBox. */
export interface DiagramLayout {
  width: number;
  height: number;
  nodes: Record<string, LayoutBox>;
  /** Clé `edgeKey(from, to)` = "from->to". */
  edges: Record<string, { points: [number, number][]; label?: LayoutBox }>;
  /** Bandeau du titre éventuel (en haut du schéma). */
  title?: LayoutBox;
}

export interface GeneratedDiagram {
  id: string;
  spec: DiagramSpec;
  layout: DiagramLayout;
  /** Instants d'apparition (ms), calculés côté serveur à partir de `wordTimings`. */
  reveal: { nodes: Record<string, number>; edges: Record<string, number> };
}

export interface CameraMotion {
  fromScale: number;
  toScale: number;
  /** Pourcentage 0..100 de la largeur du schéma. */
  focusX: number;
  /** Pourcentage 0..100 de la hauteur du schéma. */
  focusY: number;
}

export interface ComparisonCard {
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
}

export interface StoryboardScene {
  id: string;
  startMs: number;
  endMs: number;
  /** Mots de la scène dans `wordTimings` : [startWord, endWord[. */
  startWord: number;
  endWord: number;
  visualType: VisualType;
  diagramId?: string;
  diagramUrl?: string;
  /** Dimensions du WebP (cadrage de la caméra). */
  diagramWidth?: number;
  diagramHeight?: number;
  cameraMotion?: CameraMotion;
  /** 1.2 : schéma généré montré (référence `GeneratedStoryboard.generatedDiagrams`). */
  generatedDiagramId?: string;
  /** 1.2 : nœud du schéma généré cadré par la caméra. */
  focusNodeId?: string;
  calloutLabel?: string;
  highlightText?: string;
  comparison?: ComparisonCard;
}

export interface QuizQuestion {
  question: string;
  /** Exactement 4 choix, déjà mélangés. */
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface GeneratedStoryboard {
  version: "1.1" | "1.2";
  totalDurationMs: number;
  hookTitle: string;
  /** Fin de la première phrase (accroche) : doit rester sous 5 s. */
  hookEndMs: number;
  audioUrl: string;
  audioMimeType: string;
  /** Script source annoté `[affiché|prononcé]` (source de vérité, régénération). */
  annotatedScript: string;
  /** SSML envoyé à la synthèse (`<sub alias>`, sans les marks). */
  ssmlWithSub: string;
  displaySegments: DisplaySegment[];
  scenes: StoryboardScene[];
  wordTimings: WordTimestamp[];
  quiz: QuizQuestion;
  /** 1.2 : schémas générés, déclarés une fois et référencés par les scènes. */
  generatedDiagrams?: GeneratedDiagram[];
}
