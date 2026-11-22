import base64
import re
import shutil
import struct

import pytest

from app import tts
from tests.conftest import make_pdf

SR = tts.SAMPLE_RATE
MARK_RE = re.compile(r'<mark name="(\d+)"/>')


def wav(seconds: float) -> bytes:
    """WAV mono 16 bits de `seconds` secondes de silence (avec un bloc LIST avant `data`)."""
    pcm = b"\x00\x00" * int(SR * seconds)
    fmt = struct.pack("<HHIIHH", 1, 1, SR, SR * 2, 2, 16)
    lst = b"INFOtest"
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(lst) + 8 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<I", len(fmt)) + fmt
        + b"LIST" + struct.pack("<I", len(lst)) + lst
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )  # fmt: skip


@pytest.fixture
def fake_google(monkeypatch):
    """Simule v1beta1 : 0,3 s par mot, une timepoint par mark reçue."""
    calls: list[dict] = []

    def fake_request(body, timeout=120):
        calls.append(body)
        ssml = body["input"]["ssml"]
        marks = [int(m) for m in MARK_RE.findall(ssml)]
        words = len(re.sub(r"<[^>]+>", " ", ssml).split())
        timepoints = [{"markName": str(m), "timeSeconds": 0.3 * k} for k, m in enumerate(marks)]
        return {"audioContent": base64.b64encode(wav(0.3 * max(words, 1))).decode(), "timepoints": timepoints}

    monkeypatch.setattr(tts, "synthesize_request", fake_request)
    return calls


def units(n: int, sentence_every: int = 10) -> list[dict]:
    out = []
    for i in range(n):
        word = f"mot{i}" + ("." if (i + 1) % sentence_every == 0 else "")
        out.append({"word": word, "ssml": word})
    return out


# ---------------------------------------------------------------------------
# Unités
# ---------------------------------------------------------------------------


def test_pcm_of_finds_data_chunk_after_list():
    assert len(tts.pcm_of(wav(0.5))) == SR  # 0,5 s × 24 000 × 2 octets
    assert tts.pcm_of(b"\x01\x02") == b"\x01\x02"


def test_chunks_respect_limit_and_cut_at_sentence_end():
    us = [tts.Unit(u["word"], u["ssml"]) for u in units(600)]
    chunks = tts.build_chunks(us, 1)
    assert len(chunks) > 1
    assert all(c.bytes <= tts.SAFE_REQUEST_BYTES for c in chunks)
    assert [i for c in chunks for i in c.indexes] == list(range(600))  # ni perte ni doublon
    for c in chunks[:-1]:
        assert us[c.indexes[-1]].word.endswith(".")


def test_single_huge_word_is_permanent_error():
    with pytest.raises(tts.TtsError) as err:
        tts.build_chunks([tts.Unit("x", "a" * 5000)], 1)
    assert err.value.permanent


def test_fragment_whitelist():
    tts.validate_units([tts.Unit("l'ATP", '<sub alias="l\'a té pé">l\'ATP</sub>'), tts.Unit("3'.", '<sub alias="trois prime">3\'</sub>.')])
    for bad in ('<break time="1s"/>', '<audio src="x"/>', "<sub>x</sub>", "a < b"):
        with pytest.raises(tts.TtsError):
            tts.validate_units([tts.Unit("x", bad)])


def test_word_timings_interpolate_between_sparse_marks():
    words = ["a", "bb", "c", "dddd"]
    out = tts.word_timings(words, {0: 0.0, 2: 1.0}, 2.0)
    assert [w["start_ms"] for w in out][0::2] == [0, 1000]
    assert 0 < out[1]["start_ms"] < 1000 and 1000 < out[3]["start_ms"] < 2000
    assert out[-1]["end_ms"] == 2000
    assert [w["exact"] for w in out] == [True, False, True, False]


def test_verdict_flags_missing_marks():
    timings = tts.word_timings(["a", "b", "c"], {0: 0.0, 1: 0.4}, 1.2)
    v = tts.verdict(timings, {0: 0.0, 1: 0.4}, 3)
    assert not v["ok"] and "marks manquantes" in v["fails"]


# ---------------------------------------------------------------------------
# POST /tts
# ---------------------------------------------------------------------------


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg absent")
def test_tts_endpoint_offsets_marks_across_requests(client, fake_google):
    res = client.post("/tts", json={"units": units(400), "voice": "fr-FR-Neural2-F"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["requests"] == len(fake_google) > 1
    assert all(c["enableTimePointing"] == ["SSML_MARK"] for c in fake_google)
    assert all(c["audioConfig"]["audioEncoding"] == "LINEAR16" for c in fake_google)
    timings = body["word_timings"]
    assert len(timings) == 400
    starts = [w["start_ms"] for w in timings]
    assert starts == sorted(starts)
    # 0,3 s par mot, décalage correct au passage d'une requête à l'autre.
    assert starts[-1] == pytest.approx(399 * 300, abs=2)
    assert body["duration_ms"] == pytest.approx(400 * 300, abs=2)
    assert body["verdict"]["ok"] and body["verdict"]["mark_coverage_pct"] == 100
    mp3 = base64.b64decode(body["audio_base64"])
    assert body["mime_type"] == "audio/mpeg" and len(mp3) == body["bytes"] > 1000
    assert mp3[:3] == b"ID3" or mp3[0] == 0xFF
    assert body["billable_chars"] > body["billable_chars_without_marks"]


def test_tts_rejects_injected_ssml(client, fake_google):
    res = client.post("/tts", json={"units": [{"word": "x", "ssml": '<audio src="https://x"/>'}]})
    assert res.status_code == 422
    assert not fake_google


def test_tts_google_errors(client, monkeypatch):
    def bad_request(body, timeout=120):
        raise tts.TtsError("TTS 400 : SSML invalide", permanent=True)

    monkeypatch.setattr(tts, "synthesize_request", bad_request)
    assert client.post("/tts", json={"units": units(3)}).status_code == 422

    def unavailable(body, timeout=120):
        raise tts.TtsError("TTS 503")

    monkeypatch.setattr(tts, "synthesize_request", unavailable)
    assert client.post("/tts", json={"units": units(3)}).status_code == 502


def test_tts_requires_secret(client):
    assert client.post("/tts", json={}, headers={"X-Worker-Secret": "faux"}).status_code == 401


# ---------------------------------------------------------------------------
# POST /page-text
# ---------------------------------------------------------------------------


def test_page_text(client, fake_r2, tmp_path):
    url = fake_r2.add("lot.pdf", make_pdf(tmp_path / "lot.pdf", 5))
    res = client.post("/page-text", json={"source_url": url, "pages": [4, 2, 2, 9]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["page_count"] == 5
    assert [p["page"] for p in body["pages"]] == [2, 4]
    assert "Contenu de la page 4." in body["pages"][1]["text"]
