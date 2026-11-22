"""Découpe des schémas : rendu 200 DPI, marge de sécurité, WebP < 100 Ko.

Repris de `spikes/s2_figures.py` (S.2 validée : `cut_text_ratio` 0,053 avec
une marge de 4 %). `cut_text` signale une légende ou annotation coupée par le
bord de la découpe.
"""
from __future__ import annotations

import base64
import io

import pymupdf as fitz
from PIL import Image

# Seuils d'échec de S.2 (spikes/RESULTS.md) → repli Mistral OCR si dépassés.
THRESHOLDS = {"cut_text_ratio_max": 0.10, "invalid_box_ratio_max": 0.05}
QUALITIES = (85, 75, 65, 55, 45)
MIN_BOX_SIZE = 10  # sur 1000 : une boîte plus fine est dégénérée


def box_error(page: int, box: list[float], page_count: int) -> str | None:
    if not 1 <= page <= page_count:
        return f"page {page} hors document ({page_count} pages)"
    if len(box) != 4:
        return "box_2d doit contenir 4 valeurs"
    ymin, xmin, ymax, xmax = box
    if min(box) < 0 or max(box) > 1000:
        return "coordonnées hors 0..1000"
    if ymax - ymin < MIN_BOX_SIZE or xmax - xmin < MIN_BOX_SIZE:
        return "boîte dégénérée"
    return None


def to_rect(page: fitz.Page, box: list[float], margin: float) -> fitz.Rect:
    r = page.rect
    y0, x0, y1, x1 = box
    w, h = (x1 - x0) / 1000 * r.width, (y1 - y0) / 1000 * r.height
    return fitz.Rect(
        x0 / 1000 * r.width - margin * w,
        y0 / 1000 * r.height - margin * h,
        x1 / 1000 * r.width + margin * w,
        y1 / 1000 * r.height + margin * h,
    ) & r


def encode_webp(img: Image.Image, max_bytes: int) -> tuple[bytes, int]:
    """Qualité dégressive, puis réduction de taille si nécessaire.

    `method=6` (le plus compact) est lent sur les grandes images : on cherche
    la qualité avec `method=4`, puis on garde la version `method=6` si elle
    tient aussi dans la limite.
    """
    def save(image: Image.Image, q: int, method: int) -> bytes:
        buf = io.BytesIO()
        image.save(buf, "WEBP", quality=q, method=method)
        return buf.getvalue()

    while True:
        for q in QUALITIES:
            data = save(img, q, 4)
            if len(data) <= max_bytes:
                best = save(img, q, 6)
                return (best, q) if len(best) <= len(data) else (data, q)
        if min(img.size) <= 200:
            return data, q  # cas extrême : on garde la plus petite version
        # Réduction proportionnelle à l'excès (la taille varie ~ comme la surface).
        scale = max(0.5, min(0.9, (max_bytes / len(data)) ** 0.5 * 0.95))
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)


def cut_text_blocks(page: fitz.Page, clip: fitz.Rect) -> list[str]:
    """Blocs de texte à cheval sur le bord de la découpe."""
    cut = []
    for x0, y0, x1, y1, text, *_ in page.get_text("blocks"):
        b = fitz.Rect(x0, y0, x1, y1)
        inter = b & clip
        if not inter.is_empty and b.get_area() > 0:
            ratio = inter.get_area() / b.get_area()
            if 0.15 < ratio < 0.85 and text.strip():
                cut.append(text.strip()[:60])
    return cut


def crop_figure(doc: fitz.Document, page_no: int, box: list[float], margin: float, dpi: int, max_bytes: int) -> dict:
    page = doc[page_no - 1]
    clip = to_rect(page, box, margin)
    pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    data, quality = encode_webp(img, max_bytes)
    with Image.open(io.BytesIO(data)) as out:
        width, height = out.size
    return {
        "width": width,
        "height": height,
        "bytes": len(data),
        "quality": quality,
        "clip": [round(v, 1) for v in clip],
        "cut_text": cut_text_blocks(page, clip),
        "webp_base64": base64.b64encode(data).decode(),
    }


def crop_all(doc: fitz.Document, figures: list[dict], margin: float, dpi: int, max_bytes: int) -> dict:
    crops, invalid = [], []
    for i, f in enumerate(figures):
        err = box_error(f["page"], f["box_2d"], doc.page_count)
        if err:
            invalid.append({"index": i, "reason": err})
            continue
        crops.append({"index": i, "page": f["page"], **crop_figure(doc, f["page"], f["box_2d"], margin, dpi, max_bytes)})
    n = len(figures)
    metrics = {
        "figures": n,
        "cropped": len(crops),
        "invalid_box_ratio": round(len(invalid) / n, 3) if n else 0.0,
        "cut_text_ratio": round(sum(1 for c in crops if c["cut_text"]) / len(crops), 3) if crops else 0.0,
        "avg_kb": round(sum(c["bytes"] for c in crops) / len(crops) / 1024, 1) if crops else 0.0,
    }
    fails = [
        k
        for k, lim in (("cut_text_ratio", "cut_text_ratio_max"), ("invalid_box_ratio", "invalid_box_ratio_max"))
        if metrics[k] > THRESHOLDS[lim]
    ]
    metrics["verdict"] = {"ok": not fails, "fails": fails, "thresholds": THRESHOLDS}
    return {"crops": crops, "invalid": invalid, "metrics": metrics}
