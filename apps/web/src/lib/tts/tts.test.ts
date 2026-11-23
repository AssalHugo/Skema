import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wavenetVoiceFor } from "./adapter";
import { ttsListCostUsd, ttsMarginalCostUsd, voiceFamily } from "./pricing";

describe("pricing TTS", () => {
  it("reconnaît la famille de voix", () => {
    assert.equal(voiceFamily("fr-FR-Neural2-F"), "neural2");
    assert.equal(voiceFamily("fr-FR-Wavenet-G"), "wavenet");
    assert.equal(voiceFamily("fr-FR-Standard-A"), "standard");
    assert.equal(voiceFamily("fr-FR-Chirp3-HD-Aoede"), "chirp3-hd");
  });

  it("ne facture que la part au-delà du palier gratuit mensuel", () => {
    assert.equal(ttsMarginalCostUsd("fr-FR-Neural2-F", 5_000, 0), 0);
    assert.equal(ttsMarginalCostUsd("fr-FR-Neural2-F", 5_000, 998_000), (3_000 / 1e6) * 16);
    assert.equal(ttsMarginalCostUsd("fr-FR-Neural2-F", 5_000, 2_000_000), ttsListCostUsd("fr-FR-Neural2-F", 5_000));
  });
});

describe("repli WaveNet", () => {
  it("garde la lettre de la voix principale", () => {
    assert.equal(wavenetVoiceFor("fr-FR-Neural2-G"), "fr-FR-Wavenet-G");
    assert.equal(wavenetVoiceFor("voix-inconnue"), "fr-FR-Wavenet-F");
  });
});
