"""Transferts R2 ↔ worker par URL pré-signées.

Le worker ne détient aucun identifiant R2 : l'appelant (Trigger.dev) lui donne
une URL GET pré-signée pour lire la source et des URL PUT pré-signées pour
écrire les résultats. Les fichiers transitent en streaming par `/tmp`.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import requests

CHUNK = 1024 * 1024
# Polycopiés de 120+ Mo : marge large, mais bornée (le /tmp de Cloud Run est en RAM).
MAX_DOWNLOAD_BYTES = int(os.environ.get("MAX_DOWNLOAD_BYTES", str(400 * 1024 * 1024)))
DEFAULT_ALLOWED_HOSTS = "r2.cloudflarestorage.com"


class TransferError(Exception):
    """Échec de lecture ou d'écriture d'un objet distant (→ HTTP 502)."""


class UrlNotAllowed(ValueError):
    """URL refusée par la liste d'hôtes autorisés (→ HTTP 422)."""


def check_url(url: str) -> None:
    """Défense en profondeur contre le SSRF : HTTPS et hôtes R2 uniquement.

    `ALLOWED_URL_HOSTS` : suffixes d'hôtes séparés par des virgules
    (défaut : `r2.cloudflarestorage.com`), ou `*` pour tout hôte HTTPS.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise UrlNotAllowed("URL HTTPS attendue")
    allowed = os.environ.get("ALLOWED_URL_HOSTS", DEFAULT_ALLOWED_HOSTS)
    suffixes = [s.strip().lower().lstrip(".") for s in allowed.split(",") if s.strip()]
    if "*" in suffixes:
        return
    host = parsed.hostname.lower()
    if not any(host == s or host.endswith("." + s) for s in suffixes):
        raise UrlNotAllowed(f"hôte non autorisé : {host}")


def download_to(url: str, dest: Path, max_bytes: int = MAX_DOWNLOAD_BYTES) -> int:
    """Télécharge `url` dans `dest` en streaming. Renvoie la taille en octets."""
    check_url(url)
    try:
        with requests.get(url, stream=True, timeout=(10, 120), allow_redirects=False) as res:
            if res.status_code != 200:
                raise TransferError(f"lecture refusée ({res.status_code})")
            raw_len = res.headers.get("content-length")
            try:
                declared = int(raw_len) if raw_len else 0
            except ValueError as exc:
                raise TransferError(f"en-tête Content-Length invalide : {raw_len!r}") from exc
            if declared > max_bytes:
                raise TransferError(f"fichier trop volumineux ({declared} octets)")
            size = 0
            with dest.open("wb") as fh:
                for block in res.iter_content(CHUNK):
                    size += len(block)
                    if size > max_bytes:
                        raise TransferError(f"fichier trop volumineux (> {max_bytes} octets)")
                    fh.write(block)
            return size
    except requests.RequestException as exc:
        raise TransferError(f"lecture impossible : {type(exc).__name__}") from exc


def upload_file(url: str, src: Path, content_type: str) -> int:
    """PUT de `src` vers une URL pré-signée. Renvoie la taille envoyée."""
    check_url(url)
    size = src.stat().st_size
    try:
        with src.open("rb") as fh:
            res = requests.put(
                url,
                data=fh,
                headers={"Content-Type": content_type, "Content-Length": str(size)},
                timeout=(10, 300),
                allow_redirects=False,
            )
    except requests.RequestException as exc:
        raise TransferError(f"écriture impossible : {type(exc).__name__}") from exc
    if res.status_code not in (200, 201, 204):
        raise TransferError(f"écriture refusée ({res.status_code})")
    return size
