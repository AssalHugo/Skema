"""Synthèse vocale Google Cloud TTS (v1beta1) avec horodatage par mot (`<mark>`).

Reprend la méthode validée en S.3 (`spikes/s3_tts_align.py`) :
1. une `<mark name="i"/>` tous les `mark_every` mots AFFICHÉS (1 par défaut :
   l'interpolation « 1 mark tous les 4 mots » a échoué en S.3) ;
2. découpe en requêtes de 4 500 octets au plus, de préférence en fin de phrase ;
3. `v1beta1/text:synthesize` en LINEAR16 avec `enableTimePointing: ["SSML_MARK"]`
   (les timepoints n'existent pas en v1) ;
4. concaténation du PCM, décalage des timepoints, interpolation des mots sans mark ;
5. encodage MP3 mono par ffmpeg.

L'appelant (Trigger.dev) fournit les mots déjà convertis en fragments SSML
(`toSsmlUnits()` côté TypeScript : `<sub alias>` pour les sigles, nombres et
unités). Seule la balise `<sub alias="…">` est acceptée dans un fragment.

Authentification : ADC, c'est-à-dire le compte de service attaché au service
Cloud Run (aucune clé JSON). La doc officielle ne prévoit pas de clé API pour TTS.
"""
from __future__ import annotations

import base64
import os
import re
import struct
import subprocess
import threading
import time
from dataclasses import dataclass, field

import requests

ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize"
MAX_REQUEST_BYTES = 5000  # limite officielle par requête (SSML compris)
SAFE_REQUEST_BYTES = 4500  # marge pour <speak></speak>
SAMPLE_RATE = 24000
FFMPEG_TIMEOUT_SEC = 120
RETRY_STATUSES = {429, 500, 502, 503, 504}

# Seuils de S.3 (spikes/RESULTS.md), recalculés à chaque synthèse.
THRESHOLDS = {"mark_coverage_pct_min": 98, "words_under_50ms_max": 2}

# Fragment autorisé : texte échappé (aucun < ni >) et balises <sub alias="…">…</sub>.
FRAGMENT_RE = re.compile(r'^(?:[^<>]|<sub alias="[^"<>]*">[^<>]*</sub>)*$')
SENTENCE_END_RE = re.compile(r"[.!?…]\W*$")
CLAUSE_END_RE = re.compile(r"[,;:]\W*$")


class TtsError(Exception):
    """Erreur de synthèse. `permanent` : la requête est en cause (→ 422), sinon 502."""

    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


@dataclass
class Unit:
    """Un mot affiché et son fragment SSML (sans mark)."""

    word: str
    ssml: str


@dataclass
class Chunk:
    ssml: str
    indexes: list[int] = field(default_factory=list)

    @property
    def bytes(self) -> int:
        return len(self.ssml.encode("utf-8"))


# ---------------------------------------------------------------------------
# Construction du SSML
# ---------------------------------------------------------------------------


def validate_units(units: list[Unit]) -> None:
    for i, u in enumerate(units):
        if not u.word.strip():
            raise TtsError(f"mot {i} vide", permanent=True)
        if not FRAGMENT_RE.match(u.ssml):
            raise TtsError(f"fragment SSML {i} refusé (seule <sub alias> est permise) : {u.ssml[:80]!r}", True)


def _piece(i: int, unit: Unit, mark_every: int) -> str:
    mark = f'<mark name="{i}"/>' if mark_every and i % mark_every == 0 else ""
    return f"{mark}{unit.ssml} "


def build_chunks(units: list[Unit], mark_every: int, safe_bytes: int = SAFE_REQUEST_BYTES) -> list[Chunk]:
    """Découpe en requêtes ≤ `safe_bytes`, en coupant en fin de phrase, sinon de proposition."""
    pieces = [(i, _piece(i, u, mark_every)) for i, u in enumerate(units)]
    overhead = len("<speak></speak>")
    chunks: list[list[tuple[int, str]]] = []
    cur: list[tuple[int, str]] = []
    cur_bytes = overhead
    for i, piece in pieces:
        size = len(piece.encode("utf-8"))
        if size + overhead > safe_bytes:
            raise TtsError(f"le mot {i} dépasse à lui seul {safe_bytes} octets", permanent=True)
        if cur and cur_bytes + size > safe_bytes:
            cut = _cut_index(cur, units)
            chunks.append(cur[: cut + 1])
            cur = cur[cut + 1 :]
            cur_bytes = overhead + sum(len(p.encode("utf-8")) for _, p in cur)
        cur.append((i, piece))
        cur_bytes += size
    if cur:
        chunks.append(cur)
    return [Chunk("<speak>" + "".join(p for _, p in c).strip() + "</speak>", [i for i, _ in c]) for c in chunks]


def _cut_index(cur: list[tuple[int, str]], units: list[Unit]) -> int:
    """Dernier mot du segment après lequel couper : fin de phrase > fin de proposition > dernier mot."""
    for pattern in (SENTENCE_END_RE, CLAUSE_END_RE):
        hits = [k for k, (i, _) in enumerate(cur) if pattern.search(units[i].word)]
        # Ne pas laisser un segment minuscule si la seule coupure est tout au début.
        if hits and hits[-1] >= len(cur) // 3:
            return hits[-1]
    return len(cur) - 1


def plain_ssml_bytes(units: list[Unit]) -> int:
    """Octets SSML sans les marks (pour mesurer leur surcoût éventuel)."""
    return len(("<speak>" + " ".join(u.ssml for u in units) + "</speak>").encode("utf-8"))


# ---------------------------------------------------------------------------
# Appels Google
# ---------------------------------------------------------------------------

_creds_lock = threading.Lock()
_creds = None
_project: str | None = None


def _auth_headers() -> dict[str, str]:
    """Jeton OAuth du compte de service attaché (ADC), rafraîchi si besoin."""
    global _creds, _project
    with _creds_lock:
        if _creds is None:
            import google.auth

            _creds, _project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not _creds.valid:
            import google.auth.transport.requests

            _creds.refresh(google.auth.transport.requests.Request())
        headers = {"Authorization": f"Bearer {_creds.token}"}
        quota_project = getattr(_creds, "quota_project_id", None) or os.environ.get("GOOGLE_CLOUD_PROJECT") or _project
        if quota_project:
            headers["x-goog-user-project"] = quota_project
        return headers


def synthesize_request(body: dict, timeout: float = 120) -> dict:
    """POST v1beta1/text:synthesize, avec 2 nouveaux essais sur 429/5xx."""
    last = ""
    for attempt in range(3):
        try:
            headers = _auth_headers()
        except Exception as exc:  # google.auth : identifiants absents ou jeton non rafraîchi
            raise TtsError(f"authentification Google impossible : {type(exc).__name__}") from exc
        try:
            res = requests.post(ENDPOINT, headers=headers, json=body, timeout=(10, timeout))
        except requests.RequestException as exc:
            last = f"TTS injoignable : {type(exc).__name__}"
        else:
            if res.status_code < 400:
                return res.json()
            last = f"TTS {res.status_code} : {res.text[:400]}"
            if res.status_code not in RETRY_STATUSES:
                raise TtsError(last, permanent=400 <= res.status_code < 500 and res.status_code not in (401, 403))
        time.sleep(1.5 * (attempt + 1))
    raise TtsError(last)


def pcm_of(wav: bytes) -> bytes:
    """Données PCM d'un WAV (bloc `data`), ou les octets tels quels s'il n'y a pas d'en-tête."""
    if wav[:4] != b"RIFF":
        return wav
    pos = 12
    while pos + 8 <= len(wav):
        chunk_id, size = wav[pos : pos + 4], struct.unpack("<I", wav[pos + 4 : pos + 8])[0]
        if chunk_id == b"data":
            return wav[pos + 8 : pos + 8 + size]
        pos += 8 + size + (size & 1)
    raise TtsError("réponse TTS sans bloc audio")


# ---------------------------------------------------------------------------
# Horodatage
# ---------------------------------------------------------------------------


def word_timings(words: list[str], marks: dict[int, float], total_s: float) -> list[dict]:
    """Début de chaque mot : mark exacte, sinon interpolation au prorata des caractères."""
    n = len(words)
    if n == 0:
        return []
    anchors = sorted((i, t) for i, t in marks.items() if 0 <= i < n)
    if not anchors or anchors[0][0] != 0:
        anchors.insert(0, (0, 0.0))
    anchors.append((n, total_s))
    starts = [0.0] * n
    for (a, ta), (b, tb) in zip(anchors, anchors[1:]):
        if b <= a:
            continue
        lens = [len(words[k]) + 1 for k in range(a, b)]
        tot, acc = sum(lens), 0
        for k in range(a, b):
            starts[k] = ta + (tb - ta) * acc / tot
            acc += lens[k - a]
    out = []
    for k in range(n):
        end = starts[k + 1] if k + 1 < n else total_s
        out.append(
            {
                "word": words[k],
                "start_ms": round(starts[k] * 1000),
                "end_ms": round(max(end, starts[k]) * 1000),
                "exact": k in marks,
            }
        )
    return out


def verdict(timings: list[dict], marks: dict[int, float], expected_marks: int) -> dict:
    """Critères objectifs de S.3 sur la synthèse réelle (hors écart de durée, qui exigerait une 2e synthèse)."""
    coverage = round(100 * len(marks) / expected_marks, 1) if expected_marks else 100.0
    ordered = [marks[i] for i in sorted(marks)]
    monotonic = all(x <= y for x, y in zip(ordered, ordered[1:]))
    under_50 = sum(1 for w in timings if w["end_ms"] - w["start_ms"] < 50)
    fails = []
    if coverage < THRESHOLDS["mark_coverage_pct_min"]:
        fails.append("marks manquantes")
    if not monotonic:
        fails.append("timestamps non monotones")
    if under_50 > THRESHOLDS["words_under_50ms_max"]:
        fails.append("mots de durée < 50 ms")
    return {
        "ok": not fails,
        "fails": fails,
        "mark_coverage_pct": coverage,
        "monotonic": monotonic,
        "words_under_50ms": under_50,
        "thresholds": THRESHOLDS,
    }


# ---------------------------------------------------------------------------
# Encodage
# ---------------------------------------------------------------------------


def encode_mp3(pcm: bytes, sample_rate: int, kbps: int) -> bytes:
    """PCM s16le mono → MP3 CBR mono (libmp3lame)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", "-ac", "1",
        "-f", "mp3", "pipe:1",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, input=pcm, capture_output=True, timeout=FFMPEG_TIMEOUT_SEC, check=False)
    except FileNotFoundError as exc:
        raise TtsError("ffmpeg absent de l'image") from exc
    except subprocess.TimeoutExpired as exc:
        raise TtsError("encodage MP3 trop long") from exc
    if proc.returncode != 0 or not proc.stdout:
        raise TtsError(f"échec de l'encodage MP3 : {proc.stderr.decode(errors='replace')[:300]}")
    return proc.stdout


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------


def synthesize(
    units: list[Unit],
    *,
    voice: str,
    language_code: str = "fr-FR",
    speaking_rate: float = 1.0,
    mark_every: int = 1,
    sample_rate: int = SAMPLE_RATE,
    mp3_kbps: int = 64,
) -> dict:
    validate_units(units)
    chunks = build_chunks(units, mark_every)
    pcm_parts: list[bytes] = []
    marks: dict[int, float] = {}
    offset_s, latency_s = 0.0, 0.0
    for chunk in chunks:
        if chunk.bytes > MAX_REQUEST_BYTES:  # garde-fou : build_chunks vise SAFE_REQUEST_BYTES
            raise TtsError(f"requête de {chunk.bytes} octets > {MAX_REQUEST_BYTES}", permanent=True)
        body = {
            "input": {"ssml": chunk.ssml},
            "voice": {"languageCode": language_code, "name": voice},
            "audioConfig": {
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": sample_rate,
                "speakingRate": speaking_rate,
            },
        }
        if mark_every:
            body["enableTimePointing"] = ["SSML_MARK"]
        t0 = time.monotonic()
        res = synthesize_request(body)
        latency_s += time.monotonic() - t0
        if not res.get("audioContent"):
            raise TtsError("réponse TTS sans audioContent")
        pcm = pcm_of(base64.b64decode(res["audioContent"]))
        allowed = set(chunk.indexes)
        for tp in res.get("timepoints", []) or []:
            try:
                idx = int(tp["markName"])
            except (KeyError, ValueError):
                continue
            if idx in allowed:
                marks[idx] = offset_s + float(tp.get("timeSeconds", 0.0))
        pcm_parts.append(pcm)
        offset_s += len(pcm) / 2 / sample_rate

    pcm_all = b"".join(pcm_parts)
    total_s = len(pcm_all) / 2 / sample_rate
    timings = word_timings([u.word for u in units], marks, total_s)
    expected = len(range(0, len(units), mark_every)) if mark_every else 0
    mp3 = encode_mp3(pcm_all, sample_rate, mp3_kbps)
    ssml_bytes = [c.bytes for c in chunks]
    return {
        "voice": voice,
        "mime_type": "audio/mpeg",
        "duration_ms": round(total_s * 1000),
        "bytes": len(mp3),
        "audio_base64": base64.b64encode(mp3).decode("ascii"),
        "word_timings": timings,
        "requests": len(chunks),
        "ssml_bytes_per_request": ssml_bytes,
        # Estimation des caractères facturés : SSML envoyé, marks comprises (prudent).
        "billable_chars": sum(ssml_bytes),
        "billable_chars_without_marks": plain_ssml_bytes(units),
        "latency_ms": round(latency_s * 1000),
        "verdict": verdict(timings, marks, expected) if mark_every else None,
    }
