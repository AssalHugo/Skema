import base64
import io

import pymupdf as fitz
import pytest
from PIL import Image

from app import office, storage
from tests.conftest import make_pdf


def figure_pdf(path):
    """Page 1 : un schéma vectoriel (rectangle + flèche) avec sa légende dessous."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.draw_rect(fitz.Rect(100, 100, 495, 400), color=(0, 0, 1), fill=(0.8, 0.9, 1))
    page.draw_line(fitz.Point(150, 250), fitz.Point(450, 250), color=(1, 0, 0), width=3)
    page.insert_textbox(fitz.Rect(100, 410, 495, 440), "Figure 1. Chaîne respiratoire mitochondriale", fontsize=11)
    page.insert_textbox(fitz.Rect(50, 600, 545, 700), "Texte du cours sans rapport avec le schéma. " * 3, fontsize=10)
    doc.new_page(width=595, height=842)
    doc.save(path)
    doc.close()
    return path


# ---------------------------------------------------------------------------
# Sécurité
# ---------------------------------------------------------------------------


def test_business_routes_require_secret(client):
    for path in ("/split-and-inspect", "/crop-bboxes", "/pptx-to-pdf"):
        assert client.post(path, json={}, headers={"X-Worker-Secret": "faux"}).status_code == 401


@pytest.mark.parametrize(
    "url",
    [
        "http://acc.r2.cloudflarestorage.com/x",  # pas HTTPS
        "https://169.254.169.254/computeMetadata/v1/",  # métadonnées GCP
        "https://evil.example.com/x",
        "https://r2.cloudflarestorage.com.evil.com/x",
    ],
)
def test_check_url_rejects(url, monkeypatch):
    monkeypatch.delenv("ALLOWED_URL_HOSTS", raising=False)
    with pytest.raises(storage.UrlNotAllowed):
        storage.check_url(url)


def test_check_url_allowlist(monkeypatch):
    monkeypatch.delenv("ALLOWED_URL_HOSTS", raising=False)
    storage.check_url("https://acc.r2.cloudflarestorage.com/skema/a.pdf?sig=1")
    monkeypatch.setenv("ALLOWED_URL_HOSTS", "files.example.org")
    storage.check_url("https://files.example.org/a.pdf")
    with pytest.raises(storage.UrlNotAllowed):
        storage.check_url("https://acc.r2.cloudflarestorage.com/a.pdf")


def test_storage_disables_redirects_and_validates_content_length(monkeypatch, tmp_path):
    seen: list[bool] = []

    class FakeResp:
        def __init__(self, status_code: int, headers: dict[str, str]):
            self.status_code = status_code
            self.headers = headers

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_get(url, **kwargs):
        seen.append(kwargs.get("allow_redirects"))
        return FakeResp(302, {"location": "http://169.254.169.254/"})

    monkeypatch.setattr(storage.requests, "get", fake_get)
    with pytest.raises(storage.TransferError, match="302"):
        storage.download_to("https://acc.r2.cloudflarestorage.com/skema/a.pdf", tmp_path / "a.pdf")
    assert seen == [False]

    monkeypatch.setattr(storage.requests, "get", lambda url, **kw: FakeResp(200, {"content-length": "abc"}))
    with pytest.raises(storage.TransferError, match="Content-Length"):
        storage.download_to("https://acc.r2.cloudflarestorage.com/skema/a.pdf", tmp_path / "a.pdf")

    put_redirects: list[bool] = []

    def fake_put(url, **kwargs):
        put_redirects.append(kwargs.get("allow_redirects"))
        return FakeResp(302, {})

    monkeypatch.setattr(storage.requests, "put", fake_put)
    src = tmp_path / "up.pdf"
    src.write_bytes(b"pdf")
    with pytest.raises(storage.TransferError, match="302"):
        storage.upload_file("https://acc.r2.cloudflarestorage.com/skema/a.pdf", src, "application/pdf")
    assert put_redirects == [False]


def test_disallowed_source_url_is_422(client, fake_r2):
    res = client.post("/split-and-inspect", json={"source_url": "https://evil.example.com/a.pdf"})
    assert res.status_code == 422


def test_missing_object_is_502(client, fake_r2):
    url = "https://acc.r2.cloudflarestorage.com/skema/absent.pdf"
    assert client.post("/split-and-inspect", json={"source_url": url}).status_code == 502


def test_corrupted_pdf_is_422(client, fake_r2, tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"pas un pdf")
    res = client.post("/split-and-inspect", json={"source_url": fake_r2.add("bad.pdf", bad)})
    assert res.status_code == 422


def test_encrypted_pdf_is_422(client, fake_r2, tmp_path):
    path = tmp_path / "enc.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
    doc.close()
    res = client.post("/split-and-inspect", json={"source_url": fake_r2.add("enc.pdf", path)})
    assert res.status_code == 422
    assert "mot de passe" in res.json()["detail"]


# ---------------------------------------------------------------------------
# /split-and-inspect
# ---------------------------------------------------------------------------


def test_inspect_large_course(client, fake_r2, tmp_path):
    toc = [[1, "Chapitre 1", 1], [1, "Chapitre 2", 41], [1, "Chapitre 3", 101]]
    url = fake_r2.add("poly.pdf", make_pdf(tmp_path / "poly.pdf", 320, toc=toc))
    res = client.post("/split-and-inspect", json={"source_url": url})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["page_count"] == 320
    assert body["structure_source"] == "outline"
    assert body["needs_split"] is True
    chapters = body["chapters"]
    # Chapitre 2 (60 p.) gardé entier, chapitre 3 (220 p.) coupé en parties ≤ 30 p.
    assert [(c["page_start"], c["page_end"]) for c in chapters[:2]] == [(1, 40), (41, 100)]
    assert chapters[2]["title"] == "Chapitre 3 (1/8)"
    assert chapters[-1]["page_end"] == 320
    for c in chapters:
        assert sum(b["page_end"] - b["page_start"] + 1 for b in c["batches"]) == c["pages"]
        for b in c["batches"]:
            assert b["page_end"] - b["page_start"] + 1 <= 30
            assert 0 < b["bytes"] <= 40_000_000
            assert b["whole_document"] is False
    assert [(b["page_start"], b["page_end"]) for b in chapters[1]["batches"]] == [(41, 70), (71, 100)]


def test_inspect_short_document_uses_source_as_single_batch(client, fake_r2, tmp_path):
    url = fake_r2.add("court.pdf", make_pdf(tmp_path / "court.pdf", 12))
    body = client.post("/split-and-inspect", json={"source_url": url}).json()
    assert body["needs_split"] is False
    assert len(body["chapters"]) == 1
    assert body["chapters"][0]["batches"] == [
        {"page_start": 1, "page_end": 12, "bytes": body["bytes"], "whole_document": True}
    ]


def test_split_mode_writes_requested_ranges(client, fake_r2, tmp_path):
    url = fake_r2.add("poly.pdf", make_pdf(tmp_path / "poly.pdf", 70))
    uploads = [
        {"page_start": 1, "page_end": 30, "put_url": fake_r2.put_url("b0.pdf")},
        {"page_start": 31, "page_end": 70, "put_url": fake_r2.put_url("b1.pdf")},
    ]
    res = client.post("/split-and-inspect", json={"source_url": url, "uploads": uploads})
    assert res.status_code == 200, res.text
    assert [u["page_start"] for u in res.json()["uploads"]] == [1, 31]
    with fitz.open(stream=fake_r2.puts[fake_r2.put_url("b1.pdf")], filetype="pdf") as part:
        assert part.page_count == 40
        assert "page 31" in part[0].get_text()


def test_split_mode_rejects_out_of_range(client, fake_r2, tmp_path):
    url = fake_r2.add("poly.pdf", make_pdf(tmp_path / "poly.pdf", 10))
    uploads = [{"page_start": 5, "page_end": 11, "put_url": fake_r2.put_url("x.pdf")}]
    assert client.post("/split-and-inspect", json={"source_url": url, "uploads": uploads}).status_code == 422


# ---------------------------------------------------------------------------
# /crop-bboxes
# ---------------------------------------------------------------------------


def test_crop_bboxes(client, fake_r2, tmp_path):
    url = fake_r2.add("fig.pdf", figure_pdf(tmp_path / "fig.pdf"))
    # Boîte 0..1000 du schéma ET de sa légende (y 100→440, x 100→495 sur 595×842).
    full = [round(100 / 842 * 1000), round(100 / 595 * 1000), round(445 / 842 * 1000), round(495 / 595 * 1000)]
    # Boîte qui coupe la légende en deux (s'arrête au milieu de sa hauteur).
    cut = [full[0], full[1], round(423 / 842 * 1000), full[3]]
    figures = [
        {"page": 1, "box_2d": full},
        {"page": 1, "box_2d": cut},
        {"page": 3, "box_2d": full},  # page inexistante
        {"page": 1, "box_2d": [500, 500, 400, 600]},  # ymin > ymax
    ]
    res = client.post("/crop-bboxes", json={"source_url": url, "figures": figures, "margin": 0})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [c["index"] for c in body["crops"]] == [0, 1]
    assert [i["index"] for i in body["invalid"]] == [2, 3]
    ok, coupe = body["crops"]
    assert ok["cut_text"] == []
    assert coupe["cut_text"] and coupe["cut_text"][0].startswith("Figure 1")
    data = base64.b64decode(ok["webp_base64"])
    assert len(data) == ok["bytes"] < 100_000
    with Image.open(io.BytesIO(data)) as img:
        assert img.format == "WEBP"
        # 200 DPI : 395 pt de large ≈ 1097 px
        assert abs(img.width - 395 / 72 * 200) < 4
    m = body["metrics"]
    assert m["figures"] == 4 and m["cropped"] == 2
    assert m["invalid_box_ratio"] == 0.5
    assert m["cut_text_ratio"] == 0.5
    assert m["verdict"]["ok"] is False


def test_crop_respects_max_bytes(client, fake_r2, tmp_path):
    # Bruit aléatoire pleine page : incompressible, force la réduction de taille.
    path = tmp_path / "noise.pdf"
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    noise = Image.effect_noise((800, 1100), 120).convert("RGB")
    buf = io.BytesIO()
    noise.save(buf, "PNG")
    page.insert_image(page.rect, stream=buf.getvalue())
    doc.save(path)
    doc.close()
    url = fake_r2.add("noise.pdf", path)
    res = client.post(
        "/crop-bboxes",
        json={"source_url": url, "figures": [{"page": 1, "box_2d": [0, 0, 1000, 1000]}], "max_bytes": 60_000},
    )
    crop = res.json()["crops"][0]
    assert crop["bytes"] <= 60_000


# ---------------------------------------------------------------------------
# /pptx-to-pdf
# ---------------------------------------------------------------------------


@pytest.mark.skipif(office.soffice_binary() is None, reason="LibreOffice absent")
def test_pptx_to_pdf(client, fake_r2, tmp_path):
    pptx = pytest.importorskip("pptx")
    pres = pptx.Presentation()
    for n in range(3):
        slide = pres.slides.add_slide(pres.slide_layouts[1])
        slide.shapes.title.text = f"Diapositive {n + 1}"
        slide.placeholders[1].text = "La phosphorylation oxydative"
    src = tmp_path / "cours.pptx"
    pres.save(src)
    put = fake_r2.put_url("cours.pdf")
    res = client.post("/pptx-to-pdf", json={"source_url": fake_r2.add("cours.pptx", src), "put_url": put})
    assert res.status_code == 200, res.text
    assert res.json()["page_count"] == 3
    with fitz.open(stream=fake_r2.puts[put], filetype="pdf") as doc:
        assert "Diapositive 2" in doc[1].get_text()


def test_pptx_conversion_failure_is_422(client, fake_r2, tmp_path, monkeypatch):
    def boom(src, workdir):
        raise office.ConversionError("échec LibreOffice (1)")

    monkeypatch.setattr(office, "convert_to_pdf", boom)
    src = tmp_path / "x.pptx"
    src.write_bytes(b"x")
    res = client.post(
        "/pptx-to-pdf", json={"source_url": fake_r2.add("x.pptx", src), "put_url": fake_r2.put_url("x.pdf")}
    )
    assert res.status_code == 422
