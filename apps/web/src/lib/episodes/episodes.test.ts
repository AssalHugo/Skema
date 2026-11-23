import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toSsmlUnits } from "@/lib/tts/ssml";
import { EpisodeScript, annotatedScript, scriptPrompt, scriptWordCount } from "./script";
import { buildDisplaySegments, buildStoryboard, normalizeCamera, sceneWordRanges, shuffleQuiz } from "./storyboard";

const words = (n: number, prefix = "mot") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

/** Script valide : ~160 mots en 4 scènes. */
function sampleScript(): EpisodeScript {
  return {
    title: "La chaîne respiratoire",
    hookTitle: "D'où vient ton [ATP|a té pé] ?",
    scenes: [
      {
        narration: `Pourquoi respires-tu vraiment ? Pour fabriquer de l'[ATP|a té pé]. ${words(30, "a")}.`,
        visualType: "kinetic_text",
        diagramRef: null,
        camera: null,
        calloutLabel: null,
        highlightText: "[ATP|a té pé]",
        comparison: null,
      },
      {
        narration: `Les complexes pompent des protons, à [37 °C|trente-sept degrés Celsius]. ${words(35, "b")}.`,
        visualType: "diagram",
        diagramRef: "s1",
        camera: { fromScale: 0.5, toScale: 9, focusX: 130, focusY: 40 },
        calloutLabel: "Complexe I",
        highlightText: null,
        comparison: null,
      },
      {
        narration: `${words(40, "c")}.`,
        visualType: "comparison_card",
        diagramRef: null,
        camera: null,
        calloutLabel: null,
        highlightText: null,
        comparison: { leftTitle: "Matrice", leftItems: ["[pH|pé ache] 7,8"], rightTitle: "Espace", rightItems: ["pH 7"] },
      },
      {
        narration: `${words(40, "d")}. Retiens : le gradient fait tourner l'[ATP|a té pé] synthase.`,
        visualType: "diagram",
        diagramRef: "S9", // inconnu → texte animé
        camera: null,
        calloutLabel: null,
        highlightText: null,
        comparison: null,
      },
    ],
    quiz: {
      question: "Que produit l'ATP synthase ?",
      choices: ["De l'ATP", "Du NADH", "Du glucose", "De l'oxygène"],
      correctIndex: 0,
      explanation: "Elle utilise le gradient de protons.",
    },
  };
}

function timings(script: EpisodeScript, msPerWord = 400) {
  return toSsmlUnits(annotatedScript(script.scenes)).map((u, i) => ({
    word: u.word,
    startMs: i * msPerWord,
    endMs: (i + 1) * msPerWord,
  }));
}

describe("EpisodeScript", () => {
  it("accepte un script dans la tolérance et compte les mots affichés", () => {
    const s = sampleScript();
    assert.ok(EpisodeScript.safeParse(s).success);
    assert.equal(scriptWordCount(s.scenes), toSsmlUnits(annotatedScript(s.scenes)).length);
  });

  it("refuse un script trop court ou un index de quiz invalide (nouvel essai Gemini)", () => {
    const short = { ...sampleScript(), scenes: sampleScript().scenes.map((sc) => ({ ...sc, narration: "Trop court." })) };
    assert.ok(!EpisodeScript.safeParse(short).success);
    const badQuiz = { ...sampleScript(), quiz: { ...sampleScript().quiz, correctIndex: 4 } };
    assert.ok(!EpisodeScript.safeParse(badQuiz).success);
  });

  it("le prompt impose l'annotation et les règles de S.3", () => {
    const prompt = scriptPrompt({
      discipline: "biologie",
      chapterTitle: "Bioénergétique",
      conceptTitle: "Chaîne respiratoire",
      summary: "Les complexes I, III et IV pompent des protons.",
      keywords: ["chaîne respiratoire"],
      sourcePages: [34, 35],
      sourceText: [{ page: 34, text: "Le complexe I oxyde le NADH." }],
      diagrams: [{ ref: "S1", pageNumber: 34, caption: "Complexe I", aiDescription: "Pompage", attached: true }],
    });
    assert.match(prompt, /150 à 210 mots/);
    assert.match(prompt, /12 mots au plus/);
    assert.match(prompt, /\[affiché\|prononcé\]/);
    assert.match(prompt, /ponctuation reste HORS des crochets/);
    assert.match(prompt, /l'\[ATP\|a té pé\]/);
    assert.match(prompt, /\[page 34\]\nLe complexe I oxyde le NADH\./);
    assert.match(prompt, /S1 \(p\. 34, image jointe\) « Complexe I »/);
  });
});

describe("storyboard", () => {
  const diagrams = new Map([["S1", { id: "d1", url: "https://assets/d1.webp", width: 800, height: 600 }]]);

  it("cale les scènes sur l'horodatage des mots", () => {
    const script = sampleScript();
    const wt = timings(script);
    const sb = buildStoryboard({
      script,
      diagrams,
      wordTimings: wt,
      durationMs: wt.length * 400 + 300,
      audioUrl: "https://assets/a.mp3",
      audioMimeType: "audio/mpeg",
      seed: "episode-1",
    });
    const ranges = sceneWordRanges(script.scenes);
    assert.equal(sb.version, "1.1");
    assert.equal(sb.scenes.length, 4);
    assert.equal(sb.scenes[0].startMs, 0);
    assert.equal(sb.scenes[1].startMs, ranges[1].start * 400);
    assert.equal(sb.scenes[1].endMs, sb.scenes[2].startMs);
    assert.equal(sb.scenes.at(-1)?.endMs, sb.totalDurationMs);
    assert.deepEqual(sb.wordTimings, wt);
    assert.equal(sb.hookTitle, "D'où vient ton ATP ?");
    assert.equal(sb.hookEndMs, 4 * 400, "fin de la première phrase (« Pourquoi respires-tu vraiment ? »)");
    assert.match(sb.ssmlWithSub, /^<speak>Pourquoi .* de <sub alias="l'a té pé">l'ATP<\/sub>\. a0/);
    assert.doesNotMatch(sb.ssmlWithSub, /<mark/);
  });

  it("valide les visuels : schéma connu, caméra bornée, replis en texte animé", () => {
    const script = sampleScript();
    const wt = timings(script);
    const sb = buildStoryboard({
      script,
      diagrams,
      wordTimings: wt,
      durationMs: wt.length * 400,
      audioUrl: "u",
      audioMimeType: "audio/mpeg",
      seed: "x",
    });
    assert.equal(sb.scenes[0].highlightText, "ATP");
    const diag = sb.scenes[1];
    assert.equal(diag.visualType, "diagram");
    assert.equal(diag.diagramId, "d1");
    assert.equal(diag.diagramUrl, "https://assets/d1.webp");
    assert.deepEqual(diag.cameraMotion, { fromScale: 1, toScale: 3, focusX: 100, focusY: 40 });
    assert.equal(sb.scenes[2].visualType, "comparison_card");
    assert.deepEqual(sb.scenes[2].comparison?.leftItems, ["pH 7,8"]);
    assert.equal(sb.scenes[3].visualType, "kinetic_text");
    assert.equal(sb.scenes[3].diagramId, undefined);
    assert.ok(sb.scenes[3].highlightText);
  });

  it("refuse un horodatage qui ne correspond pas aux mots", () => {
    const script = sampleScript();
    assert.throws(() =>
      buildStoryboard({
        script,
        diagrams,
        wordTimings: timings(script).slice(1),
        durationMs: 1000,
        audioUrl: "u",
        audioMimeType: "audio/mpeg",
        seed: "x",
      }),
    );
  });

  it("bascule une comparison_card vide après nettoyage en kinetic_text", () => {
    const script = sampleScript();
    script.scenes[2] = {
      ...script.scenes[2],
      comparison: { leftTitle: "A", leftItems: ["   ", "[]"], rightTitle: "B", rightItems: ["ok"] },
    };
    const wt = timings(script);
    const sb = buildStoryboard({
      script,
      diagrams,
      wordTimings: wt,
      durationMs: wt.length * 400,
      audioUrl: "u",
      audioMimeType: "audio/mpeg",
      seed: "x",
    });
    assert.equal(sb.scenes[2].visualType, "kinetic_text");
    assert.equal(sb.scenes[2].comparison, undefined);
  });

  it("caméra par défaut", () => {
    assert.deepEqual(normalizeCamera(null), { fromScale: 1, toScale: 1.25, focusX: 50, focusY: 50 });
  });
});

describe("buildDisplaySegments", () => {
  const wt = (list: string[]) => list.map((word, i) => ({ word, startMs: i * 100, endMs: (i + 1) * 100 }));

  it("coupe en fin de phrase, de proposition (≥ 3 mots) ou à 7 mots, sans déborder d'une scène", () => {
    const w = wt(["Le", "pH", "baisse.", "Puis,", "les", "protons", "entrent,", "a", "b", "c", "d", "e", "f", "g", "h"]);
    const segs = buildDisplaySegments(w, [
      { start: 0, end: 7 },
      { start: 7, end: 15 },
    ]);
    assert.deepEqual(
      segs.map((s) => s.text),
      ["Le pH baisse.", "Puis, les protons entrent,", "a b c d e f g", "h"],
    );
    assert.deepEqual(
      segs.map((s) => [s.startWord, s.endWord, s.sceneIndex]),
      [
        [0, 3, 0],
        [3, 7, 0],
        [7, 14, 1],
        [14, 15, 1],
      ],
    );
    assert.equal(segs[1].startMs, 300);
    assert.equal(segs[1].endMs, 700);
  });
});

describe("shuffleQuiz", () => {
  const quiz = { question: "Q ?", choices: ["bon", "x", "y", "z"], correctIndex: 0, explanation: "E." };

  it("conserve la bonne réponse et reste déterministe", () => {
    const a = shuffleQuiz(quiz, "episode-42");
    assert.equal(a.choices[a.correctIndex], "bon");
    assert.deepEqual(a, shuffleQuiz(quiz, "episode-42"));
    assert.deepEqual([...a.choices].sort(), ["bon", "x", "y", "z"]);
  });

  it("ne laisse pas toujours la bonne réponse en premier", () => {
    const positions = new Set(Array.from({ length: 40 }, (_, i) => shuffleQuiz(quiz, `e${i}`).correctIndex));
    assert.ok(positions.size >= 3);
  });

  it("nettoie les annotations éventuelles", () => {
    const q = shuffleQuiz({ ...quiz, choices: ["l'[ATP|a té pé]", "x", "y", "z"] }, "s");
    assert.ok(q.choices.includes("l'ATP"));
  });
});
