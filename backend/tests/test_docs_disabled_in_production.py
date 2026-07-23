"""Interactive docs must stay reachable by default (LAN-only dev workflow,
unchanged behavior) but be fully disabled when ENVIRONMENT=production - see
#176 (internet exposure security audit)."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app, create_app

client = TestClient(app)


def test_docs_reachable_by_default() -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_docs_disabled_in_production() -> None:
    prod_settings = Settings(environment="production")
    prod_app = create_app(prod_settings)
    prod_client = TestClient(prod_app)

    assert prod_client.get("/docs").status_code == 404
    assert prod_client.get("/redoc").status_code == 404
    assert prod_client.get("/openapi.json").status_code == 404
