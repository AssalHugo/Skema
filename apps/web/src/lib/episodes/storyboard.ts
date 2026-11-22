/**
 * Assemblage déterministe du `storyboard_json` (contrat `GeneratedStoryboard`)
 * à partir du script Gemini et de l'horodatage TTS. Module pur, testé dans
 * `storyboard.test.ts`.
 */
import type {
  CameraMotion,
  DisplaySegment,
  GeneratedStoryboard,
  QuizQuestion,
  StoryboardScene,
  VisualType,
  WordTimestamp,
} from "@/lib/storyboard/types";
import { countWords, displayText, toSsml } from "@/lib/tts/ssml";
import { annotatedScript, type EpisodeScript } from "./script";

export interface StoryboardDiagram {
  id: string;
  url: string;
  width: number;
  height: number;
}

/** Mots par ligne de sous-titres (au plus). */
export const CAPTION_MAX_WORDS = 7;
export const HOOK_MAX_MS = 5000;

const DEFAULT_CAMERA: CameraMotion = { fromScale: 1, toScale: 1.25, focusX: 50, focusY: 50 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Texte affiché propre (annotations éventuelles résolues), tronqué. */
function label(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const clean = displayText(text).trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function normalizeCamera(c: EpisodeScript["scenes"][number]["camera"]): CameraMotion {
  if (!c) return DEFAULT_CAMERA;
  return {
    fromScale: round2(clamp(c.fromScale, 1, 3)),
    toScale: round2(clamp(c.toScale, 1, 3)),
    focusX: round2(clamp(c.focusX, 0, 100)),
    focusY: round2(clamp(c.focusY, 0, 100)),
  };
}

/** Plage de mots [start, end[ de chaque scène dans le script complet. */
export function sceneWordRanges(scenes: { narration: string }[]): { start: number; end: number }[] {
  let cursor = 0;
  return scenes.map((s) => {
    const start = cursor;
    cursor += countWords(s.narration);
    return { start, end: cursor };
  });
}

const SENTENCE_END = /[.!?…]["»”)]*$/u;
const CLAUSE_END = /[,;:]["»”)]*$/u;

/**
 * Lignes de sous-titres : coupure en fin de phrase, en fin de proposition si
 * la ligne a déjà 3 mots, sinon tous les `maxWords` mots ; jamais à cheval sur deux scènes.
 */
export function buildDisplaySegments(
  words: WordTimestamp[],
  ranges: { start: number; end: number }[],
  maxWords = CAPTION_MAX_WORDS,
): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  ranges.forEach((r, sceneIndex) => {
    let start = r.start;
    for (let i = r.start; i < r.end; i++) {
      const len = i - start + 1;
      const w = words[i].word;
      const cut = i === r.end - 1 || len >= maxWords || SENTENCE_END.test(w) || (len >= 3 && CLAUSE_END.test(w));
      if (cut) {
        segments.push({
          text: words
            .slice(start, i + 1)
            .map((x) => x.word)
            .join(" "),
          startWord: start,
          endWord: i + 1,
          startMs: words[start].startMs,
          endMs: words[i].endMs,
          sceneIndex,
        });
        start = i + 1;
      }
    }
  });
  return segments;
}

/** Fin de la première phrase de la scène 1 (accroche). */
export function hookEndMs(words: WordTimestamp[], firstScene: { start: number; end: number }): number {
  for (let i = firstScene.start; i < firstScene.end; i++) {
    if (SENTENCE_END.test(words[i].word)) return words[i].endMs;
  }
  return words[Math.max(firstScene.start, firstScene.end - 1)]?.endMs ?? 0;
}

/** Mélange déterministe (graine = identifiant de l'épisode) : le bon choix n'est pas toujours le premier. */
export function shuffleQuiz(quiz: EpisodeScript["quiz"], seed: string): QuizQuestion {
  const choices = quiz.choices.map((text, i) => ({ text: label(text, 200) ?? text, correct: i === quiz.correctIndex }));
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (let i = choices.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return {
    question: label(quiz.question, 300) ?? quiz.question,
    choices: choices.map((c) => c.text),
    correctIndex: choices.findIndex((c) => c.correct),
    explanation: label(quiz.explanation, 400) ?? quiz.explanation,
  };
}

export interface BuildStoryboardInput {
  script: EpisodeScript;
  /** Schémas proposés à Gemini, par référence (S1, S2…). */
  diagrams: Map<string, StoryboardDiagram>;
  wordTimings: WordTimestamp[];
  durationMs: number;
  audioUrl: string;
  audioMimeType: string;
  seed: string;
}

export function buildStoryboard(input: BuildStoryboardInput): GeneratedStoryboard {
  const { script, wordTimings } = input;
  const ranges = sceneWordRanges(script.scenes);
  const total = ranges.at(-1)?.end ?? 0;
  if (total !== wordTimings.length) {
    throw new Error(`Horodatage incohérent : ${wordTimings.length} mots pour ${total} attendus`);
  }

  const scenes: StoryboardScene[] = script.scenes.map((s, i) => {
    const r = ranges[i];
    const next = ranges[i + 1];
    const startMs = i === 0 ? 0 : wordTimings[r.start].startMs;
    const endMs = next ? wordTimings[next.start].startMs : input.durationMs;
    const diagram = s.diagramRef ? input.diagrams.get(s.diagramRef.trim().toUpperCase()) : undefined;
    const comparison =
      s.comparison && s.comparison.leftItems.length && s.comparison.rightItems.length
        ? {
            leftTitle: label(s.comparison.leftTitle, 40) ?? "",
            leftItems: s.comparison.leftItems.map((x) => label(x, 60) ?? "").filter(Boolean),
            rightTitle: label(s.comparison.rightTitle, 40) ?? "",
            rightItems: s.comparison.rightItems.map((x) => label(x, 60) ?? "").filter(Boolean),
          }
        : undefined;

    // Visuel demandé mais inutilisable (schéma inconnu, comparaison vide) → texte animé.
    let visualType: VisualType = s.visualType;
    if (visualType === "diagram" && !diagram) visualType = "kinetic_text";
    if (visualType === "comparison_card" && !comparison) visualType = "kinetic_text";

    const scene: StoryboardScene = {
      id: `s${i + 1}`,
      startMs,
      endMs: Math.max(endMs, startMs),
      startWord: r.start,
      endWord: r.end,
      visualType,
      calloutLabel: label(s.calloutLabel, 40),
      highlightText: label(s.highlightText, 40),
    };
    if (visualType === "diagram" && diagram) {
      Object.assign(scene, {
        diagramId: diagram.id,
        diagramUrl: diagram.url,
        diagramWidth: diagram.width,
        diagramHeight: diagram.height,
        cameraMotion: normalizeCamera(s.camera),
      });
    }
    if (visualType === "comparison_card") scene.comparison = comparison;
    if (visualType === "kinetic_text" && !scene.highlightText) {
      // Repli : la première phrase de la scène, en version affichée.
      scene.highlightText = label(displayText(s.narration).split(/(?<=[.!?…])\s/u)[0], 40);
    }
    return scene;
  });

  const fullScript = annotatedScript(script.scenes);
  return {
    version: "1.1",
    totalDurationMs: input.durationMs,
    hookTitle: label(script.hookTitle, 60) ?? label(script.title, 60) ?? "",
    hookEndMs: hookEndMs(wordTimings, ranges[0]),
    audioUrl: input.audioUrl,
    audioMimeType: input.audioMimeType,
    annotatedScript: fullScript,
    ssmlWithSub: toSsml(fullScript, 0),
    displaySegments: buildDisplaySegments(wordTimings, ranges),
    scenes,
    wordTimings,
    quiz: shuffleQuiz(script.quiz, input.seed),
  };
}
