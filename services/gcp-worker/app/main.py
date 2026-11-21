"""gcp-worker — micro-service Cloud Run de Skema.

Phase 0 : socle (sécurité, santé, configuration).
Endpoints métier à venir :
- phase 1 : POST /split-and-inspect, POST /crop-bboxes, POST /pptx-to-pdf
- phase 2 : POST /tts (Google Cloud TTS v1beta1 + <mark>, auth par le compte
  de service attaché au service Cloud Run, via ADC : aucune clé JSON)
"""
from __future__ import annotations

import hmac
import os
import shutil

from fastapi import Depends, FastAPI, Header, HTTPException, status

app = FastAPI(
    title="skema-gcp-worker",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _secret() -> str:
    secret = os.environ.get("GCP_WORKER_SECRET", "")
    if len(secret) < 32:
        # Refuse de démarrer les requêtes protégées avec un secret faible ou absent.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "GCP_WORKER_SECRET non configuré")
    return secret


def require_worker_secret(x_worker_secret: str = Header(default="")) -> None:
    """Toutes les routes métier exigent l'en-tête X-Worker-Secret."""
    if not hmac.compare_digest(x_worker_secret.encode(), _secret().encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-Worker-Secret invalide")


@app.get("/healthz")
def healthz() -> dict:
    """Sonde de santé publique (ne révèle aucune configuration sensible)."""
    return {"ok": True}


@app.get("/v1/info", dependencies=[Depends(require_worker_secret)])
def info() -> dict:
    """Diagnostic authentifié : versions et dépendances système présentes."""
    import fitz  # PyMuPDF
    import PIL

    return {
        "project": os.environ.get("GOOGLE_CLOUD_PROJECT"),
        "pymupdf": fitz.VersionBind,
        "pillow": PIL.__version__,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "tts_voice": os.environ.get("TTS_VOICE", "fr-FR-Neural2-F"),
    }
