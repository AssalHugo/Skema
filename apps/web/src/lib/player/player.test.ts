import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFeed, simulateTimings } from "@/app/demo/demo-data";
import type { DisplaySegment, WordTimestamp } from "@/lib/storyboard/types";
import type { StoryboardScene } from "@/lib/storyboard/types";
import {
  cameraAt,
  cameraFrameAt,
  cameraPlans,
  captionAt,
  diagramContentBox,
  diagramOversample,
  easeInOut,
  indexAt,
  mountedWindow,
  nextRate,
  renderKey,
  sceneProgress,
  SmoothClock,
  watchedPct,
} from "./timeline";

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

const diagramScene = (id: string, startMs: number, endMs: number, url: string, focusX: number, toScale: number): StoryboardScene => ({
  id,
  startMs,
  endMs,
  startWord: 0,
  endWord: 0,
  visualType: "diagram",
  diagramUrl: url,
  cameraMotion: { fromScale: 1, toScale, focusX, focusY: 50 },
});

describe("caméra continue", () => {
  const scenes: StoryboardScene[] = [
    diagramScene("s1", 0, 5000, "/a.webp", 20, 2),
    diagramScene("s2", 5000, 9000, "/a.webp", 80, 1.8),
    { id: "s3", startMs: 9000, endMs: 12000, startWord: 0, endWord: 0, visualType: "kinetic_text", highlightText: "x" },
    diagramScene("s4", 12000, 15000, "/a.webp", 50, 1.5),
  ];
  const plans = cameraPlans(scenes);

  it("pas de saut au changement de scène sur le même schéma", () => {
    const end1 = cameraFrameAt(scenes[0], plans[0]!, 5000);
    const start2 = cameraFrameAt(scenes[1], plans[1]!, 5000);
    assert.deepEqual(start2, end1);
    assert.ok(end1.scale > 1.9, "la scène 1 finit zoomée");
  });

  it("repart du plan d'origine après une scène sans schéma", () => {
    assert.equal(plans[2], null);
    assert.deepEqual(plans[3]!.from, cameraAt(scenes[3].cameraMotion, 0));
  });

  it("mouvement continu : pas d'écart brutal entre deux images (60 i/s)", () => {
    let prev = cameraFrameAt(scenes[0], plans[0]!, 0);
    for (let t = 16; t <= 9000; t += 16) {
      const si = indexAt(scenes, t);
      const f = cameraFrameAt(scenes[si], plans[si]!, t);
      assert.ok(Math.abs(f.scale - prev.scale) < 0.03, `zoom ${prev.scale} → ${f.scale} à ${t} ms`);
      assert.ok(Math.abs(f.translateX - prev.translateX) < 2, `translation à ${t} ms`);
      prev = f;
    }
  });

  it("travelling puis dérive lente", () => {
    const atMove = cameraFrameAt(scenes[0], plans[0]!, plans[0]!.moveMs);
    assert.equal(atMove.scale, 2);
    assert.ok(cameraFrameAt(scenes[0], plans[0]!, 5000).scale > atMove.scale);
  });

  it("sur-échantillonnage borné à 2", () => {
    assert.equal(diagramOversample(scenes, "/a.webp"), 2);
    assert.equal(diagramOversample(scenes, "/b.webp"), 1.05);
  });
});

describe("horloge lissée", () => {
  it("lisse un currentTime qui n'avance que tous les 250 ms (Safari iOS)", () => {
    const clock = new SmoothClock();
    clock.reset(0);
    let prev = clock.sample(0, 0, 1);
    const deltas: number[] = [];
    for (let now = 16; now <= 5000; now += 16) {
      const raw = Math.floor(now / 250) * 250; // paliers
      const t = clock.sample(raw, now, 1);
      deltas.push(t - prev);
      assert.ok(Math.abs(t - now) < 120, `dérive ${t - now} ms à ${now} ms`);
      prev = t;
    }
    const steady = deltas.slice(30);
    assert.ok(Math.min(...steady) > 8 && Math.max(...steady) < 26, `pas irréguliers : ${Math.min(...steady)}…${Math.max(...steady)}`);
  });

  it("monotone, recalée sur un seek, figée sur un audio bloqué", () => {
    const clock = new SmoothClock();
    clock.reset(0);
    clock.sample(0, 0, 1);
    assert.equal(clock.sample(20_000, 16, 1), 20_000);
    clock.reset(1000);
    assert.equal(clock.sample(1000, 100, 1), 1000);
    assert.ok(clock.sample(1000, 2000, 1) <= 1300, "pas d'extrapolation sans nouveau palier");
  });

  it("tient compte de la vitesse de lecture", () => {
    const clock = new SmoothClock();
    clock.reset(0);
    clock.sample(0, 0, 1.5);
    const t = clock.sample(0, 100, 1.5);
    assert.ok(Math.abs(t - 150) < 1);
  });
});

describe("renderKey", () => {
  it("ne change qu'aux frontières de mots", () => {
    const sb = { scenes: [diagramScene("s1", 0, 2000, "/a", 50, 1)], wordTimings: words };
    assert.equal(renderKey(sb, 260), renderKey(sb, 590));
    assert.notEqual(renderKey(sb, 590), renderKey(sb, 610));
  });
});

describe("cadrage sur un schéma paysage dans un panneau carré", () => {
  const box = diagramContentBox(1200, 800); // contenu : toute la largeur, 2/3 de la hauteur

  it("boîte de contenu", () => {
    assert.deepEqual(box, { cw: 1, ch: 800 / 1200 });
    assert.deepEqual(diagramContentBox(800, 1200), { cw: (800 / 1200) / 0.75, ch: 1 });
  });

  it("ne descend jamais dans la bande blanche sous le schéma", () => {
    // Zone visée tout en bas du schéma (focusY 84) : le bas du contenu zoomé doit rester sous le bas du panneau.
    const f = cameraAt({ fromScale: 1, toScale: 2.3, focusX: 66, focusY: 84 }, 1, box);
    const contentBottom = 50 + (box.ch * f.scale * 100) / 2 + f.translateY; // % du panneau
    assert.ok(contentBottom >= 100 - 1e-9, `bas du schéma à ${contentBottom} %`);
  });

  it("vise le bon point : focusY en % du schéma, pas du panneau", () => {
    const f = cameraAt({ fromScale: 2, toScale: 2, focusX: 50, focusY: 60 }, 1, box);
    // Point à +10 % du schéma = +6,67 % du panneau, ×2 après zoom → recentré de -13,33 %.
    assert.ok(Math.abs(f.translateY - -13.333) < 0.01, String(f.translateY));
  });

  it("schéma qui ne remplit pas l'axe : reste centré", () => {
    const f = cameraAt({ fromScale: 1.2, toScale: 1.2, focusX: 50, focusY: 10 }, 1, box);
    assert.equal(f.translateY, 0);
  });
});
