"""HTTP-layer coverage for app/api/routes/example_garden.py (#108: "HTTP
endpoint to trigger example-garden seeding"). The underlying
seed_example_garden() function already has thorough coverage in
test_import_example_garden.py (from #65) - nothing there exercises the
actual route (GET /api/example-garden, POST /api/example-garden/seed)
this ticket added, including its 404-when-fixture-missing behavior and
idempotency through a real HTTP round-trip rather than calling the
Python function directly.

_EXAMPLE_GARDEN_PATH is a module-level constant pointing at the real
data/example_garden.json - monkeypatched to a small tmp_path fixture here
(same pattern test_import_example_garden.py's own fixtures use) so this
stays fast/isolated rather than depending on the real, large fixture file
and a full data/plants/*.json import into garden_test."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

import app.api.routes.example_garden as example_garden_module
from app.models.garden import Garden
from app.models.plant import Plant

pytestmark = pytest.mark.integration


def _rect(x: float, y: float, width: float, height: float) -> dict:
    return {"type": "rectangle", "x": x, "y": y, "width": width, "height": height, "rotation": 0}


def _write_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, beds: list[dict]) -> Path:
    path = tmp_path / "example_garden.json"
    path.write_text(json.dumps({"beds": beds}), encoding="utf-8")
    monkeypatch.setattr(example_garden_module, "_EXAMPLE_GARDEN_PATH", path)
    return path


def test_get_example_garden_404_when_fixture_missing(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(example_garden_module, "_EXAMPLE_GARDEN_PATH", tmp_path / "does-not-exist.json")
    response = client.get("/api/example-garden")
    assert response.status_code == 404


def test_get_example_garden_returns_the_fixture_as_is(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_fixture(tmp_path, monkeypatch, [{"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)}])
    response = client.get("/api/example-garden")
    assert response.status_code == 200
    assert response.json()["beds"][0]["name"] == "Bed A"


def test_seed_example_garden_route_404_when_fixture_missing(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(example_garden_module, "_EXAMPLE_GARDEN_PATH", tmp_path / "does-not-exist.json")
    response = client.post("/api/example-garden/seed")
    assert response.status_code == 404


def test_seed_example_garden_route_creates_the_garden_and_beds(
    client: TestClient, db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The ticket's own "How to test" step 1: POST against an empty
    database creates the garden/beds/plantings from the fixture - driven
    through the real HTTP route this time, not the underlying function
    directly."""
    db_session.add(Plant(slug="test-e2e-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()
    _write_fixture(
        tmp_path,
        monkeypatch,
        [
            {"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)},
            {
                "name": "Bed B",
                "border_geometry": _rect(200, 0, 100, 100),
                "plantings": [{"plant_slug": "test-e2e-carrot", "x_cm": 50, "y_cm": 50}],
            },
        ],
    )

    response = client.post("/api/example-garden/seed")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"beds_imported": 2, "beds_failed": 0, "failures": []}
    assert db_session.exec(select(Garden)).one() is not None


def test_seed_example_garden_route_is_idempotent_through_a_real_http_round_trip(
    client: TestClient, db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The ticket's own "How to test" step 2 - calling it a second time
    through the real route doesn't duplicate anything."""
    _write_fixture(tmp_path, monkeypatch, [{"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)}])

    first = client.post("/api/example-garden/seed")
    assert first.status_code == 200, first.text
    assert first.json()["beds_imported"] == 1

    second = client.post("/api/example-garden/seed")
    assert second.status_code == 200, second.text
    assert second.json()["beds_imported"] == 1

    gardens = list(db_session.exec(select(Garden)).all())
    assert len(gardens) == 1
    beds = client.get("/api/beds").json()
    assert len(beds) == 1
