/**
 * Contrat `storyboard_json` des capsules générées (moteur 2), consommé par le
 * lecteur Live Web Rendering (phase 3). Sans dépendance serveur : importable
 * par les composants client.
 *
 * Version 1.1 = contrat d'origine (`Architecture PWA Révision Vidéo IA.md`)
 * complété par `displaySegments`, `ssmlWithSub` et `quiz` (plan, phase 2).
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

export type VisualType = "diagram" | "kinetic_text" | "comparison_card";

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
  version: "1.1";
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
}
