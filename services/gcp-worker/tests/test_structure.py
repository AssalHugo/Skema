import pymupdf as fitz

from app import structure
from tests.conftest import make_pdf


def chapters_of(path, **kw):
    with fitz.open(path) as doc:
        return structure.detect_chapters(doc, **kw)


def spans(chapters):
    return [(c.page_start, c.page_end) for c in chapters]


def test_even_ranges():
    assert structure.even_ranges(1, 60, 30) == [(1, 30), (31, 60)]
    assert structure.even_ranges(1, 61, 30) == [(1, 21), (22, 41), (42, 61)]
    assert structure.even_ranges(5, 7, 30) == [(5, 7)]


def test_outline_with_document_title_root(tmp_path):
    toc = [[1, "Polycopié UE 6", 1], [2, "Chapitre 1 — Cellule", 3], [2, "Chapitre 2", 31], [2, "Chapitre 3", 61]]
    source, chapters, stats = chapters_of(make_pdf(tmp_path / "a.pdf", 90, toc=toc))
    assert source == "outline"
    # Les 2 pages liminaires sont rattachées au 1er chapitre.
    assert spans(chapters) == [(1, 30), (31, 60), (61, 90)]
    assert chapters[0].title == "Chapitre 1 — Cellule"
    assert stats["text_pages_ratio"] == 1.0


def test_outline_descends_into_long_chapters(tmp_path):
    toc = [
        [1, "Partie A", 1],
        [1, "Partie B", 21],
        [2, "B.1", 23],
        [2, "B.2", 60],
        [2, "B.3", 100],
    ]
    source, chapters, _ = chapters_of(make_pdf(tmp_path / "b.pdf", 130, toc=toc))
    assert source == "outline"
    assert spans(chapters) == [(1, 20), (21, 59), (60, 99), (100, 130)]
    assert chapters[1].title == "Partie B · B.1"


def test_long_chapter_without_children_is_split(tmp_path):
    toc = [[1, "Intro", 1], [1, "Gros chapitre", 11]]
    _, chapters, _ = chapters_of(make_pdf(tmp_path / "c.pdf", 100, toc=toc))
    assert spans(chapters) == [(1, 10), (11, 40), (41, 70), (71, 100)]
    assert chapters[1].title == "Gros chapitre (1/3)"


def test_per_slide_bookmarks_fall_back(tmp_path):
    toc = [[1, f"Diapo {n}", n] for n in range(1, 41)]
    source, chapters, _ = chapters_of(make_pdf(tmp_path / "d.pdf", 40, toc=toc))
    assert source == "fixed"
    assert spans(chapters) == [(1, 20), (21, 40)]


def test_short_chapters_are_merged(tmp_path):
    toc = [[1, "Préface", 1], [1, "Ch 1", 2], [1, "Ch 2", 20], [1, "Annexe", 39]]
    _, chapters, _ = chapters_of(make_pdf(tmp_path / "e.pdf", 40, toc=toc))
    # « Préface » (1 p.) fusionne avec « Ch 1 », « Annexe » (2 p.) avec « Ch 2 ».
    assert [(c.title, c.page_start, c.page_end) for c in chapters] == [("Ch 1", 1, 19), ("Ch 2", 20, 40)]


def test_heading_detection_ignores_toc_page_and_running_headers(tmp_path):
    starts = {3: "1", 15: "2", 40: "3"}

    def page_text(n):
        if n == 2:  # sommaire
            return [("Chapitre 1 Introduction", 12, 100), ("Chapitre 2 Respiration", 12, 140), ("Chapitre 3 ATP", 12, 180)]
        lines = [("Texte courant du cours. " * 6, 10, 300)]
        current = max((p for p in starts if p <= n), default=None)
        if n in starts:
            lines.insert(0, (f"Chapitre {starts[n]}", 28, 80))
            lines.insert(1, ("La respiration cellulaire", 20, 130))
        elif current:  # en-tête courant, petite police
            lines.insert(0, (f"Chapitre {starts[current]} — suite", 9, 20))
        return lines

    source, chapters, _ = chapters_of(make_pdf(tmp_path / "f.pdf", 55, page_text=page_text))
    assert source == "headings"
    # Pages 1–2 (couverture + sommaire) rattachées au chapitre 1.
    assert spans(chapters) == [(1, 14), (15, 39), (40, 55)]
    assert chapters[0].title == "Chapitre 1 — La respiration cellulaire"


def test_fixed_chapters_without_structure(tmp_path):
    source, chapters, _ = chapters_of(make_pdf(tmp_path / "g.pdf", 70))
    assert source == "fixed"
    assert spans(chapters) == [(1, 24), (25, 47), (48, 70)]
    assert chapters[0].title == "Pages 1–24"


def test_tiny_document_is_single_chapter(tmp_path):
    source, chapters, _ = chapters_of(make_pdf(tmp_path / "h.pdf", 2))
    assert source == "single"
    assert spans(chapters) == [(1, 2)]


def test_plan_batches_respects_pages_and_bytes(tmp_path):
    with fitz.open(make_pdf(tmp_path / "i.pdf", 61)) as doc:
        batches = structure.plan_batches(doc, 1, 61)
        assert [(b.page_start, b.page_end) for b in batches] == [(1, 21), (22, 41), (42, 61)]
        assert all(b.bytes and b.bytes > 0 for b in batches)
        limit = len(structure.extract_range(doc, 1, 2))
        small = structure.plan_batches(doc, 1, 8, max_bytes=limit)
        assert len(small) >= 4  # lots coupés en deux tant qu'ils dépassent la limite
        assert all(b.bytes <= limit or b.pages == 1 for b in small)
        assert small[0].page_start == 1 and small[-1].page_end == 8
        assert all(a.page_end + 1 == b.page_start for a, b in zip(small, small[1:]))


def test_extract_range_is_a_standalone_pdf(tmp_path):
    with fitz.open(make_pdf(tmp_path / "j.pdf", 10)) as doc:
        data = structure.extract_range(doc, 4, 6)
    with fitz.open(stream=data, filetype="pdf") as part:
        assert part.page_count == 3
        assert "page 4" in part[0].get_text()
