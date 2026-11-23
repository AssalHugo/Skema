import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countWords, displayText, findUnannotatedTerms, spokenText, toSsml, toSsmlUnits } from "./ssml";

/** Script de référence de S.3 (`spikes/s3_tts_align.py`). */
const S3_SCRIPT =
  "Dans la mitochondrie, l'[ATP|a té pé] synthase produit de l'[ATP|a té pé] grâce au gradient de protons. " +
  "Pendant la réplication, l'[ADN|a dé ène] polymérase [III|trois] ajoute les nucléotides dans le sens " +
  "[5'|cinq prime] vers [3'|trois prime]. " +
  "Le [pH|pé ache] de la matrice est d'environ [7,8|sept virgule huit], contre [7,4|sept virgule quatre] " +
  "dans le cytosol, à [37 °C|trente-sept degrés Celsius]. " +
  "Une concentration de [10⁻⁶ mol/L|dix puissance moins six mole par litre] de [NADPH|ène a dé pé ache] " +
  "suffit à saturer l'enzyme.";

const unit = (annotated: string) => {
  const units = toSsmlUnits(annotated);
  assert.equal(units.length, 1, `une seule unité attendue pour ${annotated}`);
  return units[0];
};

describe("toSsmlUnits — cas de S.3", () => {
  it("ATP : élision DANS l'alias", () => {
    assert.deepEqual(unit("l'[ATP|a té pé]"), { word: "l'ATP", ssml: `<sub alias="l'a té pé">l'ATP</sub>` });
  });

  it("5' et 3' : ponctuation HORS de l'alias", () => {
    assert.deepEqual(unit("[5'|cinq prime]"), { word: "5'", ssml: `<sub alias="cinq prime">5'</sub>` });
    assert.deepEqual(unit("[3'|trois prime]."), { word: "3'.", ssml: `<sub alias="trois prime">3'</sub>.` });
  });

  it("7,8 : la virgule décimale reste dans l'affiché", () => {
    assert.deepEqual(unit("[7,8|sept virgule huit],"), {
      word: "7,8,",
      ssml: `<sub alias="sept virgule huit">7,8</sub>,`,
    });
  });

  it("37 °C : un seul mot affiché malgré l'espace", () => {
    assert.deepEqual(unit("[37 °C|trente-sept degrés Celsius]."), {
      word: "37 °C.",
      ssml: `<sub alias="trente-sept degrés Celsius">37 °C</sub>.`,
    });
  });

  it("10⁻⁶ mol/L : exposants et barre de fraction conservés à l'affichage", () => {
    assert.deepEqual(unit("[10⁻⁶ mol/L|dix puissance moins six mole par litre]"), {
      word: "10⁻⁶ mol/L",
      ssml: `<sub alias="dix puissance moins six mole par litre">10⁻⁶ mol/L</sub>`,
    });
  });

  it("une unité par mot affiché sur tout le script", () => {
    const units = toSsmlUnits(S3_SCRIPT);
    assert.equal(units.length, countWords(S3_SCRIPT));
    assert.equal(units.filter((u) => u.ssml.includes("<sub")).length, 12);
    assert.ok(units.every((u) => !/[[\]|]/.test(u.word)), "aucun crochet dans les sous-titres");
    assert.equal(units[0].word, "Dans");
    assert.equal(units.at(-1)?.word, "l'enzyme.");
  });
});

describe("toSsmlUnits — robustesse", () => {
  it("échappe le XML du texte et des alias", () => {
    assert.deepEqual(unit("A<B&C"), { word: "A<B&C", ssml: "A&lt;B&amp;C" });
    assert.deepEqual(unit('[K+|ion "potassium"]'), { word: "K+", ssml: `<sub alias="ion &quot;potassium&quot;">K+</sub>` });
  });

  it("accepte l'apostrophe typographique et la ponctuation ouvrante", () => {
    assert.deepEqual(unit("(d’[ARN|a èr ène])"), { word: "(d’ARN)", ssml: `(<sub alias="d’a èr ène">d’ARN</sub>)` });
  });

  it("évite la double élision si le modèle la répète dans « prononcé »", () => {
    assert.deepEqual(unit("l'[ATP|l'a té pé]"), { word: "l'ATP", ssml: `<sub alias="l'a té pé">l'ATP</sub>` });
    assert.deepEqual(unit("L'[ATP|l’a té pé]"), { word: "L'ATP", ssml: `<sub alias="L'a té pé">L'ATP</sub>` });
    assert.equal(spokenText("L'[ATP|l'a té pé]"), "L'a té pé");
  });

  it("tolère une annotation mal formée", () => {
    assert.deepEqual(toSsmlUnits("[ATP] et [|x] [ADN|]"), [
      { word: "ATP", ssml: "ATP" },
      { word: "et", ssml: "et" },
      { word: "ADN", ssml: `<sub alias="ADN">ADN</sub>` },
    ]);
  });
});

describe("toSsml", () => {
  it("place une mark par mot affiché, avant le <sub>", () => {
    assert.equal(
      toSsml("Le [pH|pé ache] baisse."),
      `<speak><mark name="0"/>Le <mark name="1"/><sub alias="pé ache">pH</sub> <mark name="2"/>baisse.</speak>`,
    );
  });

  it("sans marks (ssmlWithSub) ou une mark tous les N mots", () => {
    assert.equal(toSsml("a b c", 0), "<speak>a b c</speak>");
    assert.equal(toSsml("a b c", 2), `<speak><mark name="0"/>a b <mark name="2"/>c</speak>`);
  });
});

describe("texte affiché / prononcé", () => {
  it("dérive les deux chaînes parallèles", () => {
    const s = "L'[ATP|a té pé] fournit l'énergie à [37 °C|trente-sept degrés Celsius].";
    assert.equal(displayText(s), "L'ATP fournit l'énergie à 37 °C.");
    assert.equal(spokenText(s), "L'a té pé fournit l'énergie à trente-sept degrés Celsius.");
  });
});

describe("findUnannotatedTerms", () => {
  it("signale sigles, nombres et unités non annotés", () => {
    assert.deepEqual(findUnannotatedTerms("L'ADN contient 3 milliards de paires, à 37 °C, pH 7,4."), [
      "L'ADN",
      "3",
      "37",
      "°C",
      "pH",
      "7,4",
    ]);
  });

  it("ignore ce qui est annoté et les majuscules de début de phrase", () => {
    assert.deepEqual(findUnannotatedTerms(S3_SCRIPT), []);
  });
});
