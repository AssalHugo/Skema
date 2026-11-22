"""gcp-worker — micro-service Cloud Run de Skema.

Phase 1 (ingestion) :
- POST /split-and-inspect : chapitres + lots de 25–30 pages, ou écriture des lots ;
- POST /crop-bboxes : découpe des schémas en WebP (< 100 Ko) + métrique `cut_text` ;
- POST /pptx-to-pdf : conversion LibreOffice headless.
Phase 2 : POST /tts (Google Cloud TTS v1beta1 + <mark>, auth par le compte de
service attaché au service Cloud Run, via ADC : aucune clé JSON).

Le worker n'a aucun identifiant R2 : il lit et écrit par URL pré-signées.
"""
from __future__ import annotations

import hmac
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Iterator, Literal

import pymupdf as fitz
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from . import crop, office, storage, structure

app = FastAPI(
    title="skema-gcp-worker",
    version="0.2.0",
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


Protected = [Depends(require_worker_secret)]


@app.get("/healthz")
def healthz() -> dict:
    """Sonde de santé publique (ne révèle aucune configuration sensible)."""
    return {"ok": True}


@app.get("/v1/info", dependencies=Protected)
def info() -> dict:
    """Diagnostic authentifié : versions et dépendances système présentes."""
    import PIL

    return {
        "project": os.environ.get("GOOGLE_CLOUD_PROJECT"),
        "pymupdf": fitz.VersionBind,
        "pillow": PIL.__version__,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "libreoffice": office.soffice_binary() is not None,
        "tts_voice": os.environ.get("TTS_VOICE", "fr-FR-Neural2-F"),
    }


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------


@contextmanager
def workdir() -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="skema-", ignore_cleanup_errors=True) as d:
        yield Path(d)


@contextmanager
def errors_as_http() -> Iterator[None]:
    try:
        yield
    except storage.UrlNotAllowed as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"URL refusée : {exc}") from exc
    except storage.TransferError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except office.ConversionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def open_pdf(path: Path) -> fitz.Document:
    try:
        doc = fitz.open(path, filetype="pdf")
    except Exception as exc:  # PyMuPDF lève des types variés selon la corruption
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "PDF illisible ou corrompu") from exc
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "PDF protégé par mot de passe")
    if doc.page_count == 0:
        doc.close()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "PDF sans page")
    return doc


# ---------------------------------------------------------------------------
# POST /split-and-inspect
# ---------------------------------------------------------------------------


class RangeUpload(BaseModel):
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)
    put_url: str

    @model_validator(mode="after")
    def _ordered(self) -> "RangeUpload":
        if self.page_end < self.page_start:
            raise ValueError("page_end < page_start")
        return self


class SplitInspectRequest(BaseModel):
    source_url: str
    batch_max_pages: int = Field(structure.BATCH_MAX_PAGES, ge=5, le=100)
    batch_max_bytes: int = Field(structure.BATCH_MAX_BYTES, ge=1_000_000, le=50_000_000)
    chapter_min_pages: int = Field(structure.CHAPTER_MIN_PAGES, ge=1, le=20)
    chapter_max_pages: int = Field(structure.CHAPTER_MAX_PAGES, ge=10, le=500)
    measure_batches: bool = True
    # Renseigné : mode « découpe » (écrit ces tranches sur R2, sans inspection).
    uploads: list[RangeUpload] = Field(default_factory=list, max_length=200)


@app.post("/split-and-inspect", dependencies=Protected)
def split_and_inspect(req: SplitInspectRequest) -> dict:
    """Inspection (chapitres + lots) ou, avec `uploads`, écriture des lots demandés."""
    with errors_as_http(), workdir() as tmp:
        src = tmp / "source.pdf"
        size = storage.download_to(req.source_url, src)
        doc = open_pdf(src)
        try:
            if req.uploads:
                return {"page_count": doc.page_count, "uploads": _write_ranges(doc, req.uploads, tmp)}
            return {"bytes": size, **_inspect(doc, size, req)}
        finally:
            doc.close()


def _inspect(doc: fitz.Document, size: int, req: SplitInspectRequest) -> dict:
    source, chapters, stats = structure.detect_chapters(doc, req.chapter_min_pages, req.chapter_max_pages)
    whole_fits = doc.page_count <= req.batch_max_pages and size <= req.batch_max_bytes
    for ch in chapters:
        if whole_fits and ch.page_start == 1 and ch.page_end == doc.page_count:
            # Document court : le fichier source sert directement de lot.
            ch.batches = [structure.Batch(1, doc.page_count, size)]
        else:
            ch.batches = structure.plan_batches(
                doc, ch.page_start, ch.page_end, req.batch_max_pages, req.batch_max_bytes, req.measure_batches
            )
    meta_title = structure.clean_title((doc.metadata or {}).get("title", ""))
    return {
        "page_count": doc.page_count,
        "title": meta_title or None,
        "structure_source": source,
        "needs_split": not whole_fits,
        **stats,
        "chapters": [
            {**c.to_dict(), "batches": [{**b.__dict__, "whole_document": b.pages == doc.page_count} for b in c.batches]}
            for c in chapters
        ],
    }


def _write_ranges(doc: fitz.Document, uploads: list[RangeUpload], tmp: Path) -> list[dict]:
    out = []
    for u in uploads:
        if u.page_end > doc.page_count:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"pages {u.page_start}–{u.page_end} hors document ({doc.page_count} pages)",
            )
        part = tmp / f"part-{u.page_start}-{u.page_end}.pdf"
        part.write_bytes(structure.extract_range(doc, u.page_start, u.page_end))
        size = storage.upload_file(u.put_url, part, "application/pdf")
        part.unlink()
        out.append({"page_start": u.page_start, "page_end": u.page_end, "bytes": size})
    return out


# ---------------------------------------------------------------------------
# POST /crop-bboxes
# ---------------------------------------------------------------------------


class FigureBox(BaseModel):
    page: int = Field(description="1 = première page du PDF pointé par source_url")
    box_2d: Annotated[list[float], Field(description="[ymin, xmin, ymax, xmax] sur 0..1000")]


class CropRequest(BaseModel):
    source_url: str
    figures: list[FigureBox] = Field(max_length=300)
    margin: float = Field(0.04, ge=0, le=0.25)
    dpi: int = Field(200, ge=72, le=300)
    max_bytes: int = Field(100_000, ge=10_000, le=1_000_000)


@app.post("/crop-bboxes", dependencies=Protected)
def crop_bboxes(req: CropRequest) -> dict:
    """WebP de chaque boîte valide (base64), boîtes invalides et métriques S.2."""
    with errors_as_http(), workdir() as tmp:
        src = tmp / "source.pdf"
        storage.download_to(req.source_url, src)
        doc = open_pdf(src)
        try:
            return {
                "page_count": doc.page_count,
                **crop.crop_all(doc, [f.model_dump() for f in req.figures], req.margin, req.dpi, req.max_bytes),
            }
        finally:
            doc.close()


# ---------------------------------------------------------------------------
# POST /pptx-to-pdf
# ---------------------------------------------------------------------------


class ConvertRequest(BaseModel):
    source_url: str
    put_url: str
    extension: Literal["pptx", "ppt", "odp"] = "pptx"


@app.post("/pptx-to-pdf", dependencies=Protected)
def pptx_to_pdf(req: ConvertRequest) -> dict:
    with errors_as_http(), workdir() as tmp:
        src = tmp / f"source.{req.extension}"
        storage.download_to(req.source_url, src)
        pdf = office.convert_to_pdf(src, tmp)
        doc = open_pdf(pdf)
        pages = doc.page_count
        doc.close()
        size = storage.upload_file(req.put_url, pdf, "application/pdf")
        return {"page_count": pages, "bytes": size}
