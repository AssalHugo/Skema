"""Structure d'un polycopié : chapitres et lots de pages pour Gemini Vision.

Ordre des stratégies de détection des chapitres :
1. `outline` : signets du PDF (sommaire interactif), en descendant d'un niveau
   quand un chapitre est trop long et qu'il a des sous-signets ;
2. `headings` : pages qui commencent par « Chapitre 2 », « Partie III »… en
   grande police (hors sommaire et en-têtes courants) ;
3. `fixed` : tranches régulières d'environ 25 pages.

Les lots (« batches ») découpent ensuite chaque chapitre en tranches de 25–30
pages et < 40 Mo, pour préserver la précision de Gemini Vision et éviter les
troncatures de la sortie JSON.
"""
from __future__ import annotations

import math
import re
import statistics
from dataclasses import asdict, dataclass, field

import pymupdf as fitz

# Valeurs par défaut (surchargées par la requête).
SPLIT_THRESHOLD_PAGES = 30   # au-delà, découpe systématique en lots
BATCH_MAX_PAGES = 30
BATCH_MAX_BYTES = 40_000_000  # limite Gemini : 50 Mo par fichier
CHAPTER_MIN_PAGES = 3        # plus court : fusionné avec le voisin
CHAPTER_MAX_PAGES = 60       # plus long : sous-signets, sinon découpe en parties
FRONT_MATTER_MAX_PAGES = 5   # pages liminaires rattachées au 1er chapitre


@dataclass
class Batch:
    page_start: int  # 1 = première page du document, bornes incluses
    page_end: int
    bytes: int | None = None

    @property
    def pages(self) -> int:
        return self.page_end - self.page_start + 1


@dataclass
class Chapter:
    title: str
    page_start: int
    page_end: int
    batches: list[Batch] = field(default_factory=list)

    @property
    def pages(self) -> int:
        return self.page_end - self.page_start + 1

    def to_dict(self) -> dict:
        d = asdict(self)
        d["pages"] = self.pages
        return d


def clean_title(title: str, limit: int = 160) -> str:
    title = re.sub(r"\s+", " ", title or "").strip(" .·-–—\t")
    return title[:limit].rstrip()


# ---------------------------------------------------------------------------
# 1. Signets
# ---------------------------------------------------------------------------


@dataclass
class _Node:
    title: str
    page: int
    children: list["_Node"] = field(default_factory=list)


def _toc_tree(doc: fitz.Document) -> list[_Node]:
    roots: list[_Node] = []
    stack: list[tuple[int, _Node]] = []
    for level, title, page in doc.get_toc(simple=True):
        title = clean_title(title)
        if not title or not (1 <= page <= doc.page_count):
            continue
        node = _Node(title, page)
        while stack and stack[-1][0] >= level:
            stack.pop()
        (stack[-1][1].children if stack else roots).append(node)
        stack.append((level, node))
    return roots


def _expand(nodes: list[_Node], lo: int, hi: int, max_pages: int, prefix: str = "") -> list[Chapter]:
    nodes = sorted((n for n in nodes if lo <= n.page <= hi), key=lambda n: n.page)
    out: list[Chapter] = []
    for i, n in enumerate(nodes):
        end = nodes[i + 1].page - 1 if i + 1 < len(nodes) else hi
        if end < n.page:  # deux signets sur la même page : le suivant l'emporte
            continue
        title = f"{prefix}{n.title}"
        if end - n.page + 1 > max_pages and n.children:
            kids = _expand(n.children, n.page, end, max_pages, prefix=f"{n.title} · ")
            if len(kids) >= 2:
                kids[0].page_start = n.page  # introduction du chapitre parent
                out.extend(kids)
                continue
        out.append(Chapter(title, n.page, end))
    return out


def outline_chapters(doc: fitz.Document, max_pages: int, min_pages: int) -> list[Chapter] | None:
    roots = _toc_tree(doc)
    # Un unique signet racine (titre du document) : on descend d'un niveau.
    while len(roots) == 1 and roots[0].children:
        roots = roots[0].children
    chapters = _expand(roots, 1, doc.page_count, max_pages)
    if len(chapters) < 2:
        return None
    # Signets « une diapositive = un signet » : inutilisables comme chapitres.
    if statistics.median(c.pages for c in chapters) < min_pages:
        return None
    return chapters


# ---------------------------------------------------------------------------
# 2. Titres de chapitre en grande police
# ---------------------------------------------------------------------------

_NUM = r"(?:\d{1,2}|[IVXLC]{1,6}|premi[eè]re?|deuxi[eè]me|troisi[eè]me|quatri[eè]me|cinqui[eè]me|sixi[eè]me|septi[eè]me|huiti[eè]me|neuvi[eè]me|dixi[eè]me|one|two|three|four|five|six|seven|eight|nine|ten)"
CHAPTER_RE = re.compile(
    rf"^\s*(chapitre|chapter|chap\.|partie|part|module|unit[ée]|unit|s[ée]quence|le[çc]on|lesson|th[èe]me)\s+({_NUM})\b",
    re.IGNORECASE,
)


def _page_lines(page: fitz.Page) -> list[tuple[str, float, float]]:
    """(texte, taille de police max, y relatif 0..1) de chaque ligne de la page."""
    height = page.rect.height or 1
    lines = []
    for block in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in block.get("lines", []):
            spans = [s for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            text = clean_title("".join(s["text"] for s in spans), 300)
            size = max(s["size"] for s in spans)
            lines.append((text, size, line["bbox"][1] / height))
    return lines


def _body_font_size(pages_lines: list[list[tuple[str, float, float]]]) -> float:
    sizes: list[float] = []
    for lines in pages_lines:
        for text, size, _ in lines:
            sizes.extend([round(size, 1)] * min(len(text), 200))
    return statistics.median(sizes) if sizes else 10.0


def heading_chapters(doc: fitz.Document, pages_lines: list[list[tuple[str, float, float]]]) -> list[Chapter] | None:
    body = _body_font_size(pages_lines)
    starts: list[tuple[int, str]] = []
    seen: set[str] = set()
    for index, lines in enumerate(pages_lines):
        matches = [(i, l) for i, l in enumerate(lines) if CHAPTER_RE.match(l[0])]
        if len(matches) >= 3:  # page de sommaire
            continue
        for i, (text, size, y) in matches:
            if y > 0.45 or size < 1.3 * body or len(text) > 140:
                continue
            m = CHAPTER_RE.match(text)
            key = f"{m.group(1).lower()[:4]} {m.group(2).lower()}"
            if key in seen:  # en-tête courant répété sur les pages suivantes
                break
            seen.add(key)
            title = text
            # « Chapitre 2 » seul sur sa ligne : le titre suit sur la ligne d'après.
            if len(text) - m.end() < 4 and i + 1 < len(lines):
                nxt, nsize, ny = lines[i + 1]
                if ny <= 0.6 and nsize >= 1.15 * body and len(nxt) <= 120:
                    title = f"{text.rstrip(' :.-–—')} — {nxt}"
            starts.append((index + 1, clean_title(title)))
            break
    if len(starts) < 2:
        return None
    chapters = []
    for i, (page, title) in enumerate(starts):
        end = starts[i + 1][0] - 1 if i + 1 < len(starts) else doc.page_count
        chapters.append(Chapter(title, page, end))
    return chapters


# ---------------------------------------------------------------------------
# 3. Tranches régulières
# ---------------------------------------------------------------------------


def even_ranges(start: int, end: int, max_pages: int) -> list[tuple[int, int]]:
    """Découpe [start, end] en ceil(n / max_pages) tranches de tailles égales (±1)."""
    n = end - start + 1
    k = max(1, math.ceil(n / max_pages))
    base, extra = divmod(n, k)
    ranges, cur = [], start
    for i in range(k):
        size = base + (1 if i < extra else 0)
        ranges.append((cur, cur + size - 1))
        cur += size
    return ranges


def fixed_chapters(page_count: int, target_pages: int = 25) -> list[Chapter]:
    return [Chapter(f"Pages {s}–{e}", s, e) for s, e in even_ranges(1, page_count, target_pages)]


# ---------------------------------------------------------------------------
# Normalisation commune
# ---------------------------------------------------------------------------


def normalize(chapters: list[Chapter], page_count: int, min_pages: int, max_pages: int) -> list[Chapter]:
    chapters = sorted(chapters, key=lambda c: c.page_start)
    # Pages liminaires (couverture, sommaire) : rattachées ou chapitre dédié.
    first = chapters[0]
    if first.page_start > 1:
        if first.page_start - 1 <= FRONT_MATTER_MAX_PAGES:
            first.page_start = 1
        else:
            chapters.insert(0, Chapter("Introduction", 1, first.page_start - 1))
    # Continuité stricte : chaque chapitre finit juste avant le suivant.
    for cur, nxt in zip(chapters, chapters[1:]):
        cur.page_end = nxt.page_start - 1
    chapters[-1].page_end = page_count

    # Fusion des chapitres trop courts avec le précédent (ou le suivant).
    merged: list[Chapter] = []
    for c in chapters:
        if merged and c.pages < min_pages:
            merged[-1].page_end = c.page_end
        elif merged and merged[-1].pages < min_pages:
            prev = merged.pop()
            merged.append(Chapter(c.title, prev.page_start, c.page_end))
        else:
            merged.append(c)

    # Découpe des chapitres trop longs (sans sous-signets exploitables).
    out: list[Chapter] = []
    for c in merged:
        if c.pages > max_pages:
            parts = even_ranges(c.page_start, c.page_end, BATCH_MAX_PAGES)
            out.extend(Chapter(f"{c.title} ({i}/{len(parts)})", s, e) for i, (s, e) in enumerate(parts, 1))
        else:
            out.append(c)
    return out


def detect_chapters(
    doc: fitz.Document,
    min_pages: int = CHAPTER_MIN_PAGES,
    max_pages: int = CHAPTER_MAX_PAGES,
) -> tuple[str, list[Chapter], dict]:
    """Renvoie (stratégie, chapitres, statistiques du document)."""
    # Part de pages avec une couche texte (sinon : scan, cut_text non pertinent).
    text_pages = sum(1 for p in doc if len(p.get_text("text").strip()) >= 80)
    stats = {"text_pages_ratio": round(text_pages / max(1, doc.page_count), 3)}

    if doc.page_count <= min_pages:
        title = clean_title((doc.metadata or {}).get("title", "")) or f"Pages 1–{doc.page_count}"
        return "single", [Chapter(title, 1, doc.page_count)], stats
    for source, found in (
        ("outline", lambda: outline_chapters(doc, max_pages, min_pages)),
        ("headings", lambda: heading_chapters(doc, [_page_lines(p) for p in doc])),
    ):
        chapters = found()
        if chapters:
            return source, normalize(chapters, doc.page_count, min_pages, max_pages), stats
    return "fixed", normalize(fixed_chapters(doc.page_count), doc.page_count, min_pages, max_pages), stats


# ---------------------------------------------------------------------------
# Lots de pages
# ---------------------------------------------------------------------------


def extract_range(doc: fitz.Document, page_start: int, page_end: int) -> bytes:
    """PDF autonome des pages [page_start, page_end] (1-indexées, incluses)."""
    sub = fitz.open()
    try:
        sub.insert_pdf(doc, from_page=page_start - 1, to_page=page_end - 1)
        return sub.tobytes(garbage=3, deflate=True)
    finally:
        sub.close()


def plan_batches(
    doc: fitz.Document,
    page_start: int,
    page_end: int,
    max_pages: int = BATCH_MAX_PAGES,
    max_bytes: int = BATCH_MAX_BYTES,
    measure: bool = True,
) -> list[Batch]:
    """Lots de ≤ `max_pages` pages ; un lot > `max_bytes` est coupé en deux."""
    pending = [Batch(s, e) for s, e in even_ranges(page_start, page_end, max_pages)]
    if not measure:
        return pending
    done: list[Batch] = []
    while pending:
        b = pending.pop(0)
        b.bytes = len(extract_range(doc, b.page_start, b.page_end))
        if b.bytes > max_bytes and b.pages > 1:
            mid = b.page_start + b.pages // 2 - 1
            pending[:0] = [Batch(b.page_start, mid), Batch(mid + 1, b.page_end)]
        else:
            done.append(b)
    return done
