"""S.2 — Détection (Gemini Vision) et découpe (PyMuPDF) des schémas d'un PDF de cours. 100 % Google.

Usage :
  .venv/Scripts/python s2_figures.py inputs/cours.pdf [--model gemini-4-hydrogen] [--margin 0.04]

Sorties dans out/s2_<nom>/ :
  crops/*.webp   schémas découpés (200 DPI, marge de sécurité, < 100 Ko)
  review.html    planche de contrôle : page + boîtes prédites + zones vectorielles + découpes
  metrics.json   indicateurs objectifs (voir THRESHOLDS) → décision Gemini seul ou repli Mistral OCR
"""
import argparse
import html
import io
import time
from pathlib import Path

import pymupdf as fitz
from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel, Field

from common import OUT, require, save_json, usage_report


class Figure(BaseModel):
    page: int = Field(description="Numéro de page, 1 = première page")
    box_2d: list[int] = Field(description="[ymin, xmin, ymax, xmax] normalisés 0..1000, flèches et légendes incluses")
    caption: str = Field(description="Légende ou titre visible du schéma, vide si absent")
    description: str = Field(description="Ce que montre le schéma, 1 à 2 phrases en français")


class Figures(BaseModel):
    figures: list[Figure]


PROMPT = """Ce PDF est un support de cours universitaire de biologie.
Repère chaque schéma, figure, graphique ou illustration scientifique (ignore logos, décorations,
photos de l'enseignant, bandeaux). Beaucoup de schémas sont faits de formes vectorielles et de
zones de texte superposées : la boîte doit englober TOUT le schéma, y compris flèches,
annotations et légendes autour. Coordonnées box_2d = [ymin, xmin, ymax, xmax] sur 0..1000."""

# Critères d'échec objectifs → repli Mistral OCR si dépassés
THRESHOLDS = {
    "cut_text_ratio_max": 0.10,       # part des découpes qui coupent un bloc de texte en deux
    "missed_visual_ratio_max": 0.15,  # part des zones visuelles (images/vecteurs) non couvertes
    "invalid_box_ratio_max": 0.05,    # boîtes hors page / dégénérées
}


def to_rect(page, box, margin=0.0):
    r = page.rect
    y0, x0, y1, x1 = box
    w, h = (x1 - x0) / 1000 * r.width, (y1 - y0) / 1000 * r.height
    return fitz.Rect(x0 / 1000 * r.width - margin * w, y0 / 1000 * r.height - margin * h,
                     x1 / 1000 * r.width + margin * w, y1 / 1000 * r.height + margin * h) & r


def crop(doc, fig: Figure, margin: float, dpi: int, dest: Path) -> dict:
    page = doc[fig.page - 1]
    clip = to_rect(page, fig.box_2d, margin)
    pix = page.get_pixmap(dpi=dpi, clip=clip)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    for q in (85, 75, 65, 55, 45):  # qualité dégressive jusqu'à passer sous 100 Ko
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() < 100_000:
            break
    dest.write_bytes(buf.getvalue())
    return {"file": dest.name, "width": pix.width, "height": pix.height, "kb": round(buf.tell() / 1024, 1),
            "quality": q, "clip": [round(v, 1) for v in clip]}


def cut_text_blocks(page, clip: fitz.Rect) -> list[str]:
    """Blocs de texte à cheval sur le bord de la découpe (légende/annotation probablement coupée)."""
    cut = []
    for x0, y0, x1, y1, text, *_ in page.get_text("blocks"):
        b = fitz.Rect(x0, y0, x1, y1)
        inter = b & clip
        if not inter.is_empty and b.get_area() > 0:
            ratio = inter.get_area() / b.get_area()
            if 0.15 < ratio < 0.85 and text.strip():
                cut.append(text.strip()[:60])
    return cut


def visual_regions(page) -> list[fitz.Rect]:
    """Zones visuelles « candidates » : images raster + amas de tracés vectoriels assez grands."""
    regions = [fitz.Rect(b["bbox"]) for b in page.get_image_info() if fitz.Rect(b["bbox"]).get_area() > 0]
    try:
        clusters = page.cluster_drawings(x_tolerance=20, y_tolerance=20)
    except Exception:
        clusters = []
    regions += [fitz.Rect(c) for c in clusters]
    min_area = 0.03 * page.rect.get_area()  # ignore puces, filets, petits logos
    return [r & page.rect for r in regions if r.get_area() >= min_area and r.height < 0.95 * page.rect.height]


def main():
    env = require("GEMINI_API_KEY")
    a = argparse.ArgumentParser()
    a.add_argument("pdf", type=Path)
    a.add_argument("--model", default="gemini-4-hydrogen")
    a.add_argument("--margin", type=float, default=0.04)
    a.add_argument("--dpi", type=int, default=200)
    args = a.parse_args()

    doc = fitz.open(args.pdf)
    folder = OUT / f"s2_{args.pdf.stem}"
    cdir = folder / "crops"
    cdir.mkdir(parents=True, exist_ok=True)
    print(f"{args.pdf.name} : {doc.page_count} pages, {args.pdf.stat().st_size / 1e6:.1f} Mo")
    if args.pdf.stat().st_size > 50e6 or doc.page_count > 1000:
        raise SystemExit("PDF > 50 Mo ou > 1 000 pages : à découper d'abord (limite Gemini)")

    client = genai.Client(api_key=env["GEMINI_API_KEY"])
    uploaded = client.files.upload(file=args.pdf)
    t0 = time.time()
    resp = client.models.generate_content(
        model=args.model,
        contents=[uploaded, PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Figures,
            thinking_config=types.ThinkingConfig(thinking_level="medium"),
        ),
    )
    latency = time.time() - t0
    figs = resp.parsed.figures if resp.parsed else []
    usage = usage_report(args.model, resp.usage_metadata)
    print(f"Gemini {args.model} : {len(figs)} figures en {latency:.1f}s — {usage}")

    rows, invalid = [], 0
    for i, f in enumerate(figs):
        b = f.box_2d
        if not (1 <= f.page <= doc.page_count) or len(b) != 4 or b[0] >= b[2] or b[1] >= b[3] \
                or min(b) < 0 or max(b) > 1000:
            invalid += 1
            continue
        info = crop(doc, f, args.margin, args.dpi, cdir / f"p{f.page:03d}_{i:02d}.webp")
        info["cut_text"] = cut_text_blocks(doc[f.page - 1], fitz.Rect(info["clip"]))
        rows.append({**f.model_dump(), **info})

    # Zones visuelles non couvertes par une boîte prédite (schéma manqué potentiel)
    missed, total_regions, region_map = [], 0, {}
    for n in range(1, doc.page_count + 1):
        page = doc[n - 1]
        clips = [fitz.Rect(r["clip"]) for r in rows if r["page"] == n]
        regs = visual_regions(page)
        region_map[n] = regs
        total_regions += len(regs)
        for rg in regs:
            covered = sum((rg & c).get_area() for c in clips) / rg.get_area()
            if covered < 0.5:
                missed.append({"page": n, "rect": [round(v) for v in rg]})

    metrics = {
        "pages": doc.page_count,
        "figures_predicted": len(figs),
        "figures_cropped": len(rows),
        "invalid_box_ratio": round(invalid / max(1, len(figs)), 3),
        "cut_text_ratio": round(sum(1 for r in rows if r["cut_text"]) / max(1, len(rows)), 3),
        "visual_regions_detected": total_regions,
        "missed_visual_ratio": round(len(missed) / max(1, total_regions), 3),
        "avg_crop_kb": round(sum(r["kb"] for r in rows) / max(1, len(rows)), 1),
        "latency_s": round(latency, 1),
        "usage": usage,
        "cost_per_1000_pages_usd": round(usage.get("cost_usd", 0) / doc.page_count * 1000, 3) if usage else None,
    }
    fails = [k for k, lim in (("cut_text_ratio", "cut_text_ratio_max"), ("missed_visual_ratio", "missed_visual_ratio_max"),
                              ("invalid_box_ratio", "invalid_box_ratio_max")) if metrics[k] > THRESHOLDS[lim]]
    metrics["verdict"] = {"ok": not fails, "fails": fails, "thresholds": THRESHOLDS,
                          "note": "missed_visual_ratio est un indicateur approximatif : contrôler review.html"}
    print("Métriques :", metrics)

    # Planche de contrôle (rouge = boîte Gemini, bleu pointillé = zone visuelle détectée par PyMuPDF)
    parts = ["<meta charset=utf-8><title>S.2 review</title><style>body{font:14px system-ui;margin:16px}"
             ".pg{display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid #ccc;padding:12px 0}"
             ".wrap{position:relative;display:inline-block}.box{position:absolute;border:2px solid red}"
             ".reg{position:absolute;border:2px dashed #2a7de1}.miss{background:rgba(42,125,225,.15)}"
             "img.c{max-width:360px;border:1px solid #888}figure{margin:0;max-width:380px}.warn{color:#c00}</style>",
             f"<h1>S.2 — {html.escape(args.pdf.name)}</h1><pre>{html.escape(str(metrics))}</pre>"
             "<p>Rouge : boîte Gemini. Bleu pointillé : zone visuelle détectée (fond bleu = non couverte).</p>"]
    pct = lambda v, tot: f"{100 * v / tot:.2f}%"
    for n in range(1, doc.page_count + 1):
        prow = [r for r in rows if r["page"] == n]
        pmiss = [m for m in missed if m["page"] == n]
        if not prow and not region_map[n]:
            continue
        page = doc[n - 1]
        W, H = page.rect.width, page.rect.height
        png = f"page_{n:03d}.png"
        page.get_pixmap(dpi=60).save(folder / png)
        boxes = "".join(
            f"<div class=box style='top:{r['box_2d'][0]/10}%;left:{r['box_2d'][1]/10}%;"
            f"height:{(r['box_2d'][2]-r['box_2d'][0])/10}%;width:{(r['box_2d'][3]-r['box_2d'][1])/10}%'></div>" for r in prow)
        regs = "".join(
            f"<div class='reg{' miss' if any(list(map(round, rg)) == m['rect'] for m in pmiss) else ''}' "
            f"style='top:{pct(rg.y0, H)};left:{pct(rg.x0, W)};height:{pct(rg.height, H)};width:{pct(rg.width, W)}'></div>"
            for rg in region_map[n])
        crops = "".join(
            f"<figure><img class=c src='crops/{r['file']}'><figcaption>{r['kb']} Ko — {html.escape(r['caption'])}"
            f"<br><i>{html.escape(r['description'])}</i>"
            + (f"<br><span class=warn>Texte coupé : {html.escape(' | '.join(r['cut_text']))}</span>" if r["cut_text"] else "")
            + "</figcaption></figure>" for r in prow)
        parts.append(f"<div class=pg><div><b>Page {n}</b><br><div class=wrap><img src='{png}' width=420>{regs}{boxes}</div></div>{crops}</div>")
    (folder / "review.html").write_text("".join(parts), encoding="utf-8")
    save_json(f"s2_{args.pdf.stem}.json", {"metrics": metrics, "figures": rows, "missed": missed})
    (folder / "metrics.json").write_text(__import__("json").dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Planche de contrôle :", folder / "review.html")


if __name__ == "__main__":
    main()
