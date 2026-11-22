import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateMetrics } from "@/trigger/ingest-chapter";
import { conceptsPrompt, targetConceptCount } from "./concepts";
import { courseKeys, slideExtension } from "./keys";
import { titleFromFilename, uploadExtension } from "./uploads";

describe("uploads", () => {
  it("reconnaît les extensions acceptées, sans tenir compte de la casse", () => {
    assert.equal(uploadExtension("UE 6 Anapath.PDF"), "pdf");
    assert.equal(uploadExtension("cours.pptx"), "pptx");
    assert.equal(uploadExtension("notes.docx"), null);
    assert.equal(uploadExtension("sans-extension"), null);
    assert.equal(uploadExtension("pdf"), null);
  });

  it("dérive un titre lisible du nom de fichier", () => {
    assert.equal(titleFromFilename("UE_6__Anapath.pdf"), "UE 6 Anapath");
    assert.equal(titleFromFilename(".pdf"), "Cours sans titre");
  });
});

describe("keys", () => {
  it("distingue diaporamas et PDF", () => {
    assert.equal(slideExtension("uploads/u/abc-cours.PPTX"), "pptx");
    assert.equal(slideExtension("uploads/u/abc-cours.pdf"), null);
    assert.equal(slideExtension("pptx"), null);
  });

  it("range les objets dérivés sous courses/<id>/", () => {
    assert.equal(courseKeys.batch("c", "ch", 31, 60), "courses/c/chapters/ch/batch-p31-60.pdf");
    assert.equal(courseKeys.diagram("c", "d"), "courses/c/diagrams/d.webp");
  });
});

describe("concepts", () => {
  it("adapte le nombre de concepts à la longueur du chapitre", () => {
    assert.match(targetConceptCount(30), /entre 8 et 20/);
    assert.equal(targetConceptCount(4), "entre 2 et 4");
  });

  it("indique la numérotation absolue de chaque fichier et les références des schémas", () => {
    const prompt = conceptsPrompt({
      chapterTitle: "Respiration",
      pageStart: 31,
      pageEnd: 70,
      discipline: "biologie",
      files: [
        { pageStart: 31, pageEnd: 50 },
        { pageStart: 51, pageEnd: 70 },
      ],
      diagrams: [{ ref: "S1", pageNumber: 34, caption: "Complexe I", aiDescription: "Pompage de protons" }],
    });
    assert.match(prompt, /Fichier 2 : pages 51 à 70 \(sa page 1 = page 51\)/);
    assert.match(prompt, /S1 \(p\. 34\) « Complexe I » : Pompage de protons/);
    assert.match(prompt, /entre 31 et 70/);
  });
});

describe("aggregateMetrics", () => {
  const batch = (figures: number, cropped: number, invalid: number, cutText: number, avgKb: number) => ({
    figures,
    cropped,
    invalid,
    cutText,
    avgKb,
    cutTextDiagramIds: Array.from({ length: cutText }, (_, i) => `d${figures}-${i}`),
  });

  it("pondère les ratios par le nombre de découpes et applique les seuils de S.2", () => {
    const m = aggregateMetrics([batch(20, 20, 0, 1, 10), batch(19, 18, 1, 1, 20)]);
    assert.equal(m.figures, 39);
    assert.equal(m.cropped, 38);
    assert.equal(m.cutTextRatio, 0.053); // 2/38, comme en S.2
    assert.equal(m.invalidBoxRatio, 0.026);
    assert.equal(m.avgKb, 14.737);
    assert.deepEqual(m.verdict.fails, []);
    assert.equal(m.cutTextDiagramIds.length, 2);
  });

  it("signale un dépassement de seuil", () => {
    const m = aggregateMetrics([batch(10, 8, 2, 2, 10)]);
    assert.deepEqual(m.verdict.fails, ["cut_text_ratio", "invalid_box_ratio"]);
    assert.equal(m.verdict.ok, false);
  });

  it("gère un chapitre sans schéma", () => {
    const m = aggregateMetrics([batch(0, 0, 0, 0, 0)]);
    assert.equal(m.cutTextRatio, 0);
    assert.equal(m.verdict.ok, true);
  });
});
