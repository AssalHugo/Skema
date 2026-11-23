import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFeed, simulateTimings } from "@/app/demo/demo-data";
import type { DisplaySegment, WordTimestamp } from "@/lib/storyboard/types";
import { cameraAt, captionAt, easeInOut, indexAt, mountedWindow, nextRate, sceneProgress, watchedPct } from "./timeline";

const words: WordTimestamp[] = [
  { word: "Le", startMs: 0, endMs: 200 },
  { word: "NADH", startMs: 250, endMs: 600 },
  { word: "cède", startMs: 650, endMs: 900 },
  { word: "ses", startMs: 1300, endMs: 1500 },
  { word: "électrons.", startMs: 1550, endMs: 2000 },
];
const segments: DisplaySegment[] = [
  { text: "Le NADH cède", startWord: 0, endWord: 3, startMs: 0, endMs: 900, sceneIndex: 0 },
  { text: "ses électrons.", startWord: 3, endWord: 5, startMs: 1300, endMs: 2000, sceneIndex: 0 },
];

describe("indexAt", () => {
  it("renvoie le dernier élément commencé", () => {
    assert.equal(indexAt(words, -1), -1);
    assert.equal(indexAt(words, 0), 0);
    assert.equal(indexAt(words, 640), 1);
    assert.equal(indexAt(words, 99_999), 4);
    assert.equal(indexAt([], 10), -1);
  });
});

describe("captionAt (karaoké)", () => {
  it("surligne le mot en cours et grise les suivants", () => {
    const c = captionAt(segments, words, 300);
    assert.equal(c?.segmentIndex, 0);
    assert.deepEqual(c?.words.map((w) => w.state), ["past", "current", "future"]);
  });
  it("garde la ligne pendant le silence entre deux mots", () => {
    const c = captionAt(segments, words, 1000);
    assert.equal(c?.segmentIndex, 0);
    assert.deepEqual(c?.words.map((w) => w.state), ["past", "past", "past"]);
  });
  it("passe à la ligne suivante", () => {
    const c = captionAt(segments, words, 1600);
    assert.equal(c?.segmentIndex, 1);
    assert.deepEqual(c?.words.map((w) => [w.word, w.state]), [
      ["ses", "past"],
      ["électrons.", "current"],
    ]);
  });
  it("rien avant la première ligne", () => {
    assert.equal(captionAt(segments, words, -5), null);
  });
});

describe("caméra", () => {
  it("easeInOut borne et symétrique", () => {
    assert.equal(easeInOut(-1), 0);
    assert.equal(easeInOut(0.5), 0.5);
    assert.equal(easeInOut(2), 1);
  });
  it("part du cadrage d'origine et recentre le point focal", () => {
    const cam = { fromScale: 1, toScale: 2, focusX: 20, focusY: 50 };
    assert.deepEqual(cameraAt(cam, 0), { scale: 1, translateX: 0, translateY: 0 });
    const end = cameraAt(cam, 1);
    assert.equal(end.scale, 2);
    // Point à -30 % du centre → -60 % après zoom ×2, recentré mais borné à 50 % (bords jamais découverts).
    assert.equal(end.translateX, 50);
    assert.equal(end.translateY, 0);
  });
  it("sans caméra : immobile", () => {
    assert.deepEqual(cameraAt(undefined, 0.7), { scale: 1, translateX: 0, translateY: 0 });
  });
  it("sceneProgress", () => {
    assert.equal(sceneProgress({ startMs: 1000, endMs: 3000 }, 2000), 0.5);
    assert.equal(sceneProgress({ startMs: 1000, endMs: 1000 }, 5000), 1);
  });
});

describe("feed", () => {
  it("vitesses 1 → 1,25 → 1,5 → 1", () => {
    assert.equal(nextRate(1), 1.25);
    assert.equal(nextRate(1.25), 1.5);
    assert.equal(nextRate(1.5), 1);
    assert.equal(nextRate(2), 1);
  });
  it("virtualisation sur 3 cartes", () => {
    assert.deepEqual(mountedWindow(0, 10), { from: 0, to: 1 });
    assert.deepEqual(mountedWindow(5, 10), { from: 4, to: 6 });
    assert.deepEqual(mountedWindow(9, 10), { from: 8, to: 9 });
  });
  it("watchedPct", () => {
    assert.equal(watchedPct(30_000, 60_000), 50);
    assert.equal(watchedPct(90_000, 60_000), 100);
    assert.equal(watchedPct(10, 0), 0);
  });
});

describe("démo /demo", () => {
  it("produit des storyboards valides via buildStoryboard", () => {
    const items = demoFeed();
    assert.equal(items.length, 3);
    for (const it of items) {
      const sb = it.storyboard;
      assert.ok(sb.scenes.length >= 4);
      assert.ok(sb.wordTimings.at(-1)!.endMs <= sb.totalDurationMs);
      assert.ok(sb.hookEndMs < 5000, `accroche ${sb.hookEndMs} ms`);
      assert.equal(sb.displaySegments.at(-1)!.endWord, sb.wordTimings.length);
    }
  });
  it("horodatage simulé monotone", () => {
    const sb = demoFeed()[0].storyboard;
    const scene = { narration: "Un deux trois.", visualType: "kinetic_text" as const, diagramRef: null, camera: null, calloutLabel: null, highlightText: null, comparison: null };
    const t = simulateTimings({ title: "", hookTitle: "", scenes: [scene], quiz: { question: "", choices: [], correctIndex: 0, explanation: "" } }, 5000);
    assert.equal(t.length, 3);
    for (let i = 1; i < sb.wordTimings.length; i++) assert.ok(sb.wordTimings[i].startMs >= sb.wordTimings[i - 1].endMs);
  });
});
