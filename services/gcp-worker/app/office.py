"""Conversion des diaporamas en PDF (LibreOffice headless).

Gemini réduit un PPTX à son texte (les schémas disparaissent) : tout
diaporama est donc converti en PDF avant l'ingestion.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

EXTENSIONS = {"pptx", "ppt", "odp"}
TIMEOUT_SEC = int(os.environ.get("SOFFICE_TIMEOUT_SEC", "300"))


class ConversionError(Exception):
    pass


def soffice_binary() -> str | None:
    return shutil.which("soffice") or shutil.which("libreoffice")


def convert_to_pdf(src: Path, workdir: Path) -> Path:
    binary = soffice_binary()
    if not binary:
        raise ConversionError("LibreOffice absent de l'image")
    profile = workdir / "lo-profile"  # profil isolé : conversions concurrentes possibles
    out_dir = workdir / "out"
    out_dir.mkdir(exist_ok=True)
    cmd = [
        binary,
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out_dir),
        str(src),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=TIMEOUT_SEC,
            env={**os.environ, "HOME": str(workdir)},
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError(f"conversion trop longue (> {TIMEOUT_SEC} s)") from exc
    pdf = out_dir / f"{src.stem}.pdf"
    if proc.returncode != 0 or not pdf.exists():
        detail = (proc.stderr or proc.stdout or b"").decode(errors="replace")[-300:]
        raise ConversionError(f"échec LibreOffice ({proc.returncode}) : {detail}")
    return pdf
