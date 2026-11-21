"""S.3 — Google Cloud TTS (fr-FR Neural2) + timestamps par mot via SSML <mark> (API v1beta1).

Usage :
  .venv/Scripts/python s3_tts_align.py [--voices fr-FR-Neural2-F fr-FR-Neural2-G] [--rate 1.0]
  # fallback Google si Neural2 déçoit : --voices fr-FR-Wavenet-F fr-FR-Standard-F
  # référence externe optionnelle : renseigner ELEVENLABS_API_KEY → comparaison avec Scribe

Trois variantes du même script :
  raw    : écriture scientifique brute (ADN, ATP, pH 7,4…), sans aide → ce que Neural2 fait seul
  spoken : texte parlé normalisé (ce que le LLM produirait en spokenText), une <mark> par mot parlé
  sub    : écriture scientifique + <sub alias="…"> SSML, une <mark> par mot AFFICHÉ
           → si ça marche, plus besoin de mapSpokenTimingsToDisplayWords()

Mesures objectives (out/s3/report.json) et écoute (out/s3/player.html).
"""
import argparse
import base64
import difflib
import html
import json
import os
import re
import statistics
import struct
import time
import unicodedata

import requests

from common import OUT, require

ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize"
MAX_BYTES = 5000          # limite officielle par requête (texte ou SSML)
SAFE_BYTES = 4500         # marge pour les balises <speak>
SAMPLE_RATE = 24000

# Syntaxe : [affiché|prononcé]  — sans crochets, le mot est identique à l'écrit et à l'oral.
SCRIPT = (
    "Dans la mitochondrie, l'[ATP|a té pé] synthase produit de l'[ATP|a té pé] grâce au gradient de protons. "
    "Pendant la réplication, l'[ADN|a dé ène] polymérase [III|trois] ajoute les nucléotides dans le sens "
    "[5'|cinq prime] vers [3'|trois prime]. "
    "Le [pH|pé ache] de la matrice est d'environ [7,8|sept virgule huit], contre [7,4|sept virgule quatre] "
    "dans le cytosol, à [37 °C|trente-sept degrés Celsius]. "
    "Une concentration de [10⁻⁶ mol/L|dix puissance moins six mole par litre] de [NADPH|ène a dé pé ache] "
    "suffit à saturer l'enzyme."
)


# ---------- construction des variantes ----------

GROUP_RE = re.compile(r"\[([^|\]]+)\|([^\]]+)\]")
SUB_RE = re.compile(r"(\w+')?\[([^|\]]+)\|([^\]]+)\]")


def tokens():
    """Liste de (affiché, prononcé|None) ; un groupe [..|..] peut être collé à « l' » ou à la ponctuation."""
    out = []
    for tok in re.findall(r"(?:\[[^\]]*\]|\S)+", SCRIPT):
        if "[" in tok:
            out.append((GROUP_RE.sub(r"\1", tok), GROUP_RE.sub(r"\2", tok), tok))
        else:
            out.append((tok, None, tok))
    return out


def esc(t: str) -> str:
    return html.escape(t, quote=False)


def esc_attr(t: str) -> str:
    return esc(t).replace('"', "&quot;")


def variant_units(name: str):
    """Renvoie une liste d'unités : (label_affiché, fragment_ssml_sans_mark)."""
    units = []
    for disp, spoken, raw_tok in tokens():
        if name == "raw":
            for w in disp.split():
                units.append((w, esc(w)))
        elif name == "spoken":
            for w in (spoken or disp).split():
                units.append((w, esc(w)))
        elif name == "sub":
            # Règles mesurées en S.3 sur Neural2 :
            #  - ponctuation finale HORS de l'alias (sinon l'alias est épelé lettre par lettre)
            #  - élision « l' » DANS l'alias (sinon la voix dit « l apostrophe »)
            frag = SUB_RE.sub(lambda g: f'<sub alias="{esc_attr((g[1] or "") + g[3])}">{esc((g[1] or "") + g[2])}</sub>',
                              esc(raw_tok))
            units.append((disp, frag))
    return units


def chunk_ssml(units, every: int):
    """Découpe en requêtes ≤ SAFE_BYTES, en coupant de préférence en fin de phrase."""
    chunks, cur, cur_bytes = [], [], 0
    for i, (label, frag) in enumerate(units):
        piece = (f'<mark name="{i}"/>' if every and i % every == 0 else "") + frag + " "
        b = len(piece.encode("utf-8"))
        if cur and cur_bytes + b > SAFE_BYTES:
            # reculer jusqu'à la dernière fin de phrase si possible
            cut = max((k for k, (i0, _) in enumerate(cur) if re.search(r"[.!?]\s*$", units[i0][0])), default=len(cur) - 1)
            chunks.append(cur[: cut + 1])
            cur = cur[cut + 1:]
            cur_bytes = sum(len(x[1].encode("utf-8")) for x in cur)
        cur.append((i, piece))
        cur_bytes += b
    if cur:
        chunks.append(cur)
    return [("<speak>" + "".join(p for _, p in c).strip() + "</speak>", [i for i, _ in c]) for c in chunks]


# ---------- appels API ----------

def auth():
    """Clé API (non documentée pour TTS, testée ici) sinon compte de service / ADC (méthode officielle)."""
    key = os.getenv("GOOGLE_TTS_API_KEY")
    if key:
        return {"params": {"key": key}, "headers": {}, "mode": "api_key"}
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        import google.auth
        import google.auth.transport.requests
        creds, project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        h = {"Authorization": f"Bearer {creds.token}"}
        if project:
            h["x-goog-user-project"] = project
        return {"params": {}, "headers": h, "mode": "service_account"}
    raise SystemExit("Renseigner GOOGLE_TTS_API_KEY ou GOOGLE_APPLICATION_CREDENTIALS dans spikes/.env")


def synth(ssml: str, voice: str, rate: float, every: int, a: dict):
    body = {
        "input": {"ssml": ssml},
        "voice": {"languageCode": "fr-FR", "name": voice},
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": SAMPLE_RATE, "speakingRate": rate},
    }
    if every:
        body["enableTimePointing"] = ["SSML_MARK"]
    t0 = time.time()
    r = requests.post(ENDPOINT, params=a["params"], headers=a["headers"], json=body, timeout=120)
    if r.status_code >= 400:
        raise RuntimeError(f"TTS {r.status_code} ({a['mode']}): {r.text[:600]}")
    j = r.json()
    wav = base64.b64decode(j["audioContent"])
    return wav, j.get("timepoints", []), time.time() - t0


def pcm_of(wav: bytes) -> bytes:
    """Extrait les données PCM d'un WAV (cherche le bloc 'data')."""
    i = wav.find(b"data")
    if wav[:4] != b"RIFF" or i < 0:
        return wav  # déjà du PCM brut
    size = struct.unpack("<I", wav[i + 4:i + 8])[0]
    return wav[i + 8:i + 8 + size]


def wav_bytes(pcm: bytes) -> bytes:
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16) +
            b"data" + struct.pack("<I", len(pcm)) + pcm)


def run_variant(units, voice, rate, every, a):
    pcm_all, timings, offset, latency, ssml_bytes = b"", {}, 0.0, 0.0, []
    for ssml, idxs in chunk_ssml(units, every):
        ssml_bytes.append(len(ssml.encode("utf-8")))
        if ssml_bytes[-1] > MAX_BYTES:
            raise RuntimeError(f"Chunk de {ssml_bytes[-1]} octets > {MAX_BYTES}")
        wav, tps, lat = synth(ssml, voice, rate, every, a)
        latency += lat
        pcm = pcm_of(wav)
        for tp in tps:
            timings[int(tp["markName"])] = offset + float(tp.get("timeSeconds", 0))
        pcm_all += pcm
        offset += len(pcm) / 2 / SAMPLE_RATE
    return pcm_all, timings, offset, latency, ssml_bytes


def words_from_marks(units, timings, total_s):
    """Début de chaque mot : mark exacte si présente, sinon interpolation au prorata des caractères."""
    n = len(units)
    anchors = sorted(timings.items()) + [(n, total_s)]
    starts = [None] * n
    for (a, ta), (b, tb) in zip(anchors, anchors[1:]):
        lens = [len(units[k][0]) + 1 for k in range(a, b)]
        tot, acc = sum(lens) or 1, 0
        for k in range(a, b):
            starts[k] = ta + (tb - ta) * acc / tot
            acc += lens[k - a]
    first = anchors[0][0]
    for k in range(first):  # mots avant la 1re mark (ne devrait pas arriver)
        starts[k] = anchors[0][1] * k / max(1, first)
    out = []
    for k in range(n):
        end = starts[k + 1] if k + 1 < n else total_s
        out.append({"word": units[k][0], "startMs": round(starts[k] * 1000), "endMs": round(end * 1000),
                    "exact": k in timings})
    return out


def interp_error(approx, exact):
    d = [abs(x["startMs"] - y["startMs"]) for x, y in zip(approx, exact) if not x["exact"]]
    return {"interpolated_words": len(d), "mae_ms": round(statistics.mean(d)) if d else 0,
            "max_ms": max(d) if d else 0}


# ---------- référence optionnelle Scribe ----------

def norm(w: str) -> str:
    w = unicodedata.normalize("NFD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


def scribe(wav: bytes, key: str):
    r = requests.post(
        "https://api.elevenlabs.io/v1/speech-to-text",
        headers={"xi-api-key": key},
        files={"file": ("a.wav", wav, "audio/wav")},
        data={"model_id": "scribe_v3", "language_code": "fra", "timestamps_granularity": "word"},
        timeout=300,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Scribe {r.status_code}: {r.text[:300]}")
    return [{"word": w["text"], "startMs": round(w["start"] * 1000), "endMs": round(w["end"] * 1000)}
            for w in r.json().get("words", []) if w.get("type", "word") == "word"]


def compare(google_words, ref_words):
    a = [norm(w["word"]) for w in google_words]
    b = [norm(w["word"]) for w in ref_words]
    diffs = []
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            diffs.append(abs(google_words[blk.a + k]["startMs"] - ref_words[blk.b + k]["startMs"]))
    if not diffs:
        return {"matched_words": 0}
    return {"matched_words": len(diffs), "mae_ms": round(statistics.mean(diffs)),
            "p90_ms": sorted(diffs)[int(0.9 * (len(diffs) - 1))], "max_ms": max(diffs)}


# ---------- critères d'échec objectifs ----------

THRESHOLDS = {
    "mark_coverage_pct_min": 98,     # % de marks renvoyées
    "duration_delta_pct_max": 3,     # les marks ne doivent pas ralentir / hacher la diction
    "words_under_50ms_max": 2,       # mots "écrasés" → timestamps suspects
    "scribe_mae_ms_max": 120,        # écart moyen vs référence Scribe (si fournie)
}


def verdict(e: dict) -> dict:
    fails = []
    if e["mark_coverage_pct"] < THRESHOLDS["mark_coverage_pct_min"]:
        fails.append("marks manquantes")
    if not e["monotonic"]:
        fails.append("timestamps non monotones")
    if abs(e["duration_delta_pct"] or 0) > THRESHOLDS["duration_delta_pct_max"]:
        fails.append("les marks modifient la durée/prosodie")
    if e["words_under_50ms"] > THRESHOLDS["words_under_50ms_max"]:
        fails.append("mots de durée < 50 ms")
    mae = (e.get("vs_scribe") or {}).get("mae_ms")
    if mae is not None and mae > THRESHOLDS["scribe_mae_ms_max"]:
        fails.append(f"écart moyen vs Scribe {mae} ms")
    return {"ok": not fails, "fails": fails, "to_check_by_ear": "prononciation + fluidité + calage 1x/1,25x"}


# ---------- rapport ----------

PLAYER = """<!doctype html><meta charset=utf-8><title>S.3 Google TTS</title>
<style>body{font:16px system-ui;max-width:780px;margin:24px auto;padding:0 16px}
.w{padding:1px 2px;border-radius:3px}.on{background:#ffd54a}section{margin-bottom:32px;border-top:1px solid #ccc}
button{margin:2px}code{font-size:12px}</style>
<p>Pour chaque voix et variante : écouter la prononciation, comparer avec et sans &lt;mark&gt; (fluidité),
vérifier le calage du surlignage à 1x et 1,25x.</p>%SECTIONS%
<script>
document.querySelectorAll('section').forEach(sec=>{
  const a=sec.querySelector('audio.m'), tracks=JSON.parse(sec.dataset.tracks); let cur=Object.keys(tracks)[0];
  const box=sec.querySelector('.t');
  const render=()=>box.innerHTML=(tracks[cur]||[]).map(w=>`<span class=w>${w.word}</span>`).join(' ');
  sec.querySelectorAll('[data-src]').forEach(b=>b.onclick=()=>{cur=b.dataset.src;render()});
  sec.querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>a.playbackRate=+b.dataset.rate);
  render();
  (function loop(){const t=a.currentTime*1000;(tracks[cur]||[]).forEach((w,i)=>{const el=box.children[i];
    if(el)el.classList.toggle('on',t>=w.startMs&&t<w.endMs)});requestAnimationFrame(loop)})();
});
</script>"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--voices", nargs="+", default=["fr-FR-Neural2-F", "fr-FR-Neural2-G"])
    p.add_argument("--variants", nargs="+", default=["raw", "spoken", "sub"])
    p.add_argument("--rate", type=float, default=1.0)
    p.add_argument("--mark-every", type=int, default=4,
                   help="teste aussi 1 mark tous les N mots + interpolation (réduit les caractères facturés)")
    args = p.parse_args()
    a = auth()
    el_key = os.getenv("ELEVENLABS_API_KEY")
    print(f"Auth : {a['mode']} | référence Scribe : {'oui' if el_key else 'non'}")

    folder = OUT / "s3"
    folder.mkdir(exist_ok=True)
    report, sections = [], []
    for voice in args.voices:
        for vname in args.variants:
            units = variant_units(vname)
            tag = f"{voice}_{vname}"
            entry = {"voice": voice, "variant": vname, "words": len(units)}
            try:
                pcm_m, timings, dur_m, lat, ssml_bytes = run_variant(units, voice, args.rate, 1, a)
                pcm_n, _, dur_n, _, plain_bytes = run_variant(units, voice, args.rate, 0, a)
                sparse = None
                if args.mark_every > 1:
                    _, t_sp, d_sp, _, sp_bytes = run_variant(units, voice, args.rate, args.mark_every, a)
                    sparse = (t_sp, d_sp, sp_bytes)
            except Exception as e:
                entry["error"] = str(e)
                print(tag, "ERREUR", e)
                report.append(entry)
                continue
            (folder / f"{tag}.wav").write_bytes(wav_bytes(pcm_m))
            (folder / f"{tag}_nomarks.wav").write_bytes(wav_bytes(pcm_n))
            words = words_from_marks(units, timings, dur_m)
            starts = [timings[i] for i in sorted(timings)]
            wdur = [w["endMs"] - w["startMs"] for w in words]
            entry.update({
                "requests": len(ssml_bytes),
                "ssml_bytes_per_request": ssml_bytes,
                "billable_chars_with_marks_est": sum(ssml_bytes),
                "billable_chars_without_marks_est": sum(plain_bytes),
                "marks_overhead_pct": round(100 * (sum(ssml_bytes) / max(1, sum(plain_bytes)) - 1), 1),
                "latency_s": round(lat, 2),
                "duration_s_with_marks": round(dur_m, 2),
                "duration_s_without_marks": round(dur_n, 2),
                "duration_delta_pct": round(100 * (dur_m - dur_n) / dur_n, 2) if dur_n else None,
                "mark_coverage_pct": round(100 * len(timings) / len(units), 1),
                "monotonic": all(x <= y for x, y in zip(starts, starts[1:])),
                "word_ms_median": statistics.median(wdur) if wdur else None,
                "words_under_50ms": sum(1 for d in wdur if d < 50),
            })
            if sparse:
                t_sp, d_sp, sp_bytes = sparse
                entry[f"mark_every_{args.mark_every}"] = {
                    "billable_chars_est": sum(sp_bytes),
                    "overhead_pct": round(100 * (sum(sp_bytes) / max(1, sum(plain_bytes)) - 1), 1),
                    **interp_error(words_from_marks(units, t_sp, d_sp), words),
                }
            entry["verdict"] = None  # calculé après la comparaison Scribe
            tracks = {"google_marks": words}
            if el_key:
                try:
                    ref = scribe(wav_bytes(pcm_m), el_key)
                    tracks["scribe"] = ref
                    entry["vs_scribe"] = compare(words, ref)
                except Exception as e:
                    entry["vs_scribe"] = {"error": str(e)}
            entry["verdict"] = verdict(entry)
            report.append(entry)
            print(tag, entry["verdict"], {k: entry[k] for k in ("mark_coverage_pct", "duration_delta_pct", "requests")},
                  entry.get(f"mark_every_{args.mark_every}", ""), entry.get("vs_scribe", ""))
            btn = "".join(f"<button data-src={k}>{k}</button>" for k in tracks)
            sections.append(
                f"<section data-tracks='{html.escape(json.dumps(tracks, ensure_ascii=False))}'>"
                f"<h3>{voice} — {vname}</h3>"
                f"<p>Avec marks : <audio class=m controls src='{tag}.wav'></audio></p>"
                f"<p>Sans marks : <audio controls src='{tag}_nomarks.wav'></audio></p>"
                f"<p>{btn} Vitesse : <button data-rate=1>1x</button><button data-rate=1.25>1,25x</button>"
                f"<button data-rate=1.5>1,5x</button></p><p class=t></p>"
                f"<code>{html.escape(json.dumps({k: v for k, v in entry.items() if k not in ('voice', 'variant')}, ensure_ascii=False))}</code></section>")

    (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "player.html").write_text(PLAYER.replace("%SECTIONS%", "".join(sections)), encoding="utf-8")
    print("Rapport :", folder / "report.json", "| Écoute :", folder / "player.html")


if __name__ == "__main__":
    main()
