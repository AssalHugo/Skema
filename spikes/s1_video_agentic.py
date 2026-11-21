"""S.1 — Extraction d'un segment YouTube par analyse vidéo agentique.

Usage :
  .venv/Scripts/python s1_video_agentic.py --url https://www.youtube.com/watch?v=XXXX \
      --concept "La phosphorylation oxydative" [--models gemini-4-hydrogen gemini-3.8-flash] [--mode AGENTIC|STATIC]

Ce qu'on vérifie : la syntaxe media_processing="AGENTIC", le nombre de tokens réel
pour une vidéo d'environ 12 min (le budget suppose ~46 800 tokens) et la justesse de startSec/endSec.
"""
import argparse
import time

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from common import require, save_json, usage_report


class Segment(BaseModel):
    found: bool
    startSec: int = Field(description="Début du segment, en secondes depuis le début de la vidéo")
    endSec: int = Field(description="Fin du segment, en secondes")
    summaryTitle: str = Field(description="Titre accrocheur en français, 60 caractères max")
    relevanceScore: float = Field(description="0 à 1 : pertinence pour le concept")
    justification: str = Field(description="Ce qui est expliqué dans le segment, 2 phrases")


PROMPT = """Tu es un assistant pédagogique pour des étudiants en biologie (licence).
Concept à réviser : « {concept} ».
Trouve dans cette vidéo UN segment autonome de 45 à 90 secondes qui explique ce concept
de façon compréhensible sans le reste de la vidéo (pas de début/fin coupés en pleine phrase).
Si aucun segment ne convient, renvoie found=false avec startSec=endSec=0."""


def run(client, model: str, url: str, concept: str, mode: str) -> dict:
    # mime_type obligatoire dès que media_processing est renseigné (erreur 400 sinon)
    video = types.Part(file_data=types.FileData(file_uri=url, mime_type="video/*"), media_processing=mode)
    t0 = time.time()
    resp = client.models.generate_content(
        model=model,
        contents=[video, PROMPT.format(concept=concept)],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Segment,
            thinking_config=types.ThinkingConfig(thinking_level="medium"),
        ),
    )
    seg = resp.parsed.model_dump() if resp.parsed else {"raw": resp.text}
    if seg.get("found"):
        s = seg["startSec"]
        seg["check_link"] = f"{url}{'&' if '?' in url else '?'}t={s}s"
        seg["duration"] = seg["endSec"] - s
    return {
        "model": model,
        "mode": mode,
        "latency_s": round(time.time() - t0, 1),
        "segment": seg,
        "usage": usage_report(model, resp.usage_metadata),
    }


def main():
    env = require("GEMINI_API_KEY")
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--concept", required=True)
    p.add_argument("--models", nargs="+", default=["gemini-4-hydrogen", "gemini-3.8-flash"])
    p.add_argument("--mode", default="AGENTIC", choices=["AGENTIC", "STATIC"])
    a = p.parse_args()

    # Le mode AGENTIC n'est disponible qu'en v1beta (erreur 400 constatée en v1 le 13/11/2026)
    client = genai.Client(api_key=env["GEMINI_API_KEY"], http_options=types.HttpOptions(api_version="v1beta"))
    results = []
    for m in a.models:
        print(f"→ {m} ({a.mode})…", flush=True)
        try:
            r = run(client, m, a.url, a.concept, a.mode)
        except Exception as e:  # on veut voir l'erreur exacte de l'API
            r = {"model": m, "mode": a.mode, "error": f"{type(e).__name__}: {e}"}
        print(r, flush=True)
        results.append(r)
    print("Résultats :", save_json(f"s1_{a.mode.lower()}_{int(time.time())}.json", results))


if __name__ == "__main__":
    main()
