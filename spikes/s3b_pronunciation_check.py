"""S.3 bis — Contrôle automatique de la prononciation : Gemini écoute les WAV de S.3 et transcrit
mot à mot, en toutes lettres, ce qui est réellement prononcé (sigles, nombres, unités).

Usage : .venv/Scripts/python s3b_pronunciation_check.py [--model gemini-3.8-flash]
Sortie : out/s3/pronunciation.json
"""
import argparse

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from common import OUT, require, save_json, usage_report

TERMS = ["ATP", "ADN", "polymérase III", "5'", "3'", "pH", "7,8", "7,4", "37 °C", "10⁻⁶ mol/L", "NADPH"]


class Term(BaseModel):
    term: str = Field(description="Terme écrit attendu")
    heard: str = Field(description="Ce qui est réellement prononcé, écrit en toutes lettres / lettre par lettre")
    correct: bool = Field(description="True si un étudiant francophone comprend sans ambiguïté le terme attendu")


class Check(BaseModel):
    transcript: str = Field(description="Transcription intégrale, nombres et sigles écrits tels que PRONONCÉS")
    terms: list[Term]
    fluency_issues: str = Field(description="Hachures, pauses anormales, accent étranger, vide si aucun")


PROMPT = ("Écoute cet audio en français (cours de biologie). Transcris EXACTEMENT ce qui est prononcé : "
          "écris les nombres en toutes lettres tels qu'entendus et les sigles lettre par lettre (ex: « a té pé »). "
          "Puis, pour chacun de ces termes attendus, indique ce qui a été réellement prononcé : " + ", ".join(TERMS))


def main():
    env = require("GEMINI_API_KEY")
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="gemini-3.8-flash")
    a = p.parse_args()
    client = genai.Client(api_key=env["GEMINI_API_KEY"])
    results = {}
    for wav in sorted((OUT / "s3").glob("*.wav")):
        if wav.stem.endswith("_nomarks"):
            continue
        resp = client.models.generate_content(
            model=a.model,
            contents=[types.Part.from_bytes(data=wav.read_bytes(), mime_type="audio/wav"), PROMPT],
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Check,
                                               thinking_config=types.ThinkingConfig(thinking_level="low")),
        )
        c = resp.parsed
        bad = [f"{t.term} → « {t.heard} »" for t in c.terms if not t.correct]
        results[wav.stem] = {"incorrect": bad, "fluency_issues": c.fluency_issues,
                             "terms": [t.model_dump() for t in c.terms], "transcript": c.transcript,
                             "usage": usage_report(a.model, resp.usage_metadata)}
        print(f"{wav.stem}: {len(c.terms) - len(bad)}/{len(c.terms)} corrects ; erreurs : {bad or 'aucune'}")
    print("Détail :", save_json("s3/pronunciation.json", results))


if __name__ == "__main__":
    main()
