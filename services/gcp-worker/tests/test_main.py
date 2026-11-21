from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SECRET = "s" * 40


def test_healthz_is_public():
    assert client.get("/healthz").json() == {"ok": True}


def test_protected_route_requires_secret(monkeypatch):
    monkeypatch.setenv("GCP_WORKER_SECRET", SECRET)
    assert client.get("/v1/info").status_code == 401
    assert client.get("/v1/info", headers={"X-Worker-Secret": "faux"}).status_code == 401
    res = client.get("/v1/info", headers={"X-Worker-Secret": SECRET})
    assert res.status_code == 200
    assert "pymupdf" in res.json()


def test_weak_secret_is_refused(monkeypatch):
    monkeypatch.setenv("GCP_WORKER_SECRET", "court")
    assert client.get("/v1/info", headers={"X-Worker-Secret": "court"}).status_code == 503
