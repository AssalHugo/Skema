from __future__ import annotations

import shutil
from pathlib import Path

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from app import storage
from app.main import app

SECRET = "s" * 40


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("GCP_WORKER_SECRET", SECRET)
    return TestClient(app, headers={"X-Worker-Secret": SECRET})


@pytest.fixture
def fake_r2(monkeypatch, tmp_path):
    """Remplace R2 : `objects[url] = Path` pour les lectures, `puts[url] = bytes` pour les écritures."""
    objects: dict[str, Path] = {}
    puts: dict[str, bytes] = {}

    def download_to(url, dest, max_bytes=storage.MAX_DOWNLOAD_BYTES):
        storage.check_url(url)
        if url not in objects:
            raise storage.TransferError("lecture refusée (404)")
        shutil.copy(objects[url], dest)
        return dest.stat().st_size

    def upload_file(url, src, content_type):
        storage.check_url(url)
        puts[url] = src.read_bytes()
        return len(puts[url])

    monkeypatch.setattr(storage, "download_to", download_to)
    monkeypatch.setattr(storage, "upload_file", upload_file)

    class R2:
        def add(self, name: str, path: Path) -> str:
            url = f"https://acc.r2.cloudflarestorage.com/skema/{name}?X-Amz-Signature=x"
            objects[url] = path
            return url

        def put_url(self, name: str) -> str:
            return f"https://acc.r2.cloudflarestorage.com/skema/{name}?X-Amz-Signature=put"

        @property
        def puts(self) -> dict[str, bytes]:
            return puts

    return R2()


def make_pdf(path: Path, pages: int, *, toc=None, page_text=None) -> Path:
    """PDF A4 de test. `page_text(n)` → liste de (texte, taille, y) pour la page n (1-indexée)."""
    doc = fitz.open()
    for n in range(1, pages + 1):
        page = doc.new_page(width=595, height=842)
        lines = page_text(n) if page_text else [(f"Contenu de la page {n}. " * 4, 10, 120)]
        for text, size, y in lines:
            page.insert_textbox(fitz.Rect(50, y, 545, y + size * 6), text, fontsize=size)
    if toc:
        doc.set_toc(toc)
    doc.save(path)
    doc.close()
    return path
