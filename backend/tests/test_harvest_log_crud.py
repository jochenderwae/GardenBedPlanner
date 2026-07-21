"""HarvestLog CRUD (see app/models/harvest_log.py,
app/api/routes/harvest_logs.py) - yield/quality/notes logged against a
specific Planting."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_planting(client: TestClient, db_session, plant_slug: str = "test-tomato") -> int:
    db_session.add(Plant(slug=plant_slug, common_name="Tomato", botanical_name="Solanum lycopersicum"))
    db_session.commit()
    bed_id = client.post("/api/beds", json={"name": "Bed", "border_geometry": rectangle()}).json()["id"]
    planting_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    return planting_response.json()["id"]


def test_get_missing_harvest_log_404(client: TestClient) -> None:
    assert client.get("/api/harvest-logs/999999").status_code == 404


def test_create_harvest_log_bad_planting_id_returns_409(client: TestClient) -> None:
    response = client.post(
        "/api/harvest-logs",
        json={"planting_id": 999999, "harvest_date": "2027-08-01"},
    )
    assert response.status_code == 409


def test_harvest_log_crud_round_trip(client: TestClient, db_session) -> None:
    planting_id = _create_planting(client, db_session)

    create_response = client.post(
        "/api/harvest-logs",
        json={
            "planting_id": planting_id,
            "harvest_date": "2027-08-01",
            "yield_amount": 2.5,
            "yield_unit": "kg",
            "quality": "good",
            "notes": "first real harvest",
        },
    )
    assert create_response.status_code == 201, create_response.text
    entry = create_response.json()
    assert entry["yield_amount"] == 2.5
    assert entry["quality"] == "good"
    entry_id = entry["id"]

    get_response = client.get(f"/api/harvest-logs/{entry_id}")
    assert get_response.status_code == 200
    assert get_response.json()["yield_unit"] == "kg"

    update_response = client.patch(
        f"/api/harvest-logs/{entry_id}", json={"yield_amount": 3.0, "quality": "excellent"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["yield_amount"] == 3.0
    assert update_response.json()["quality"] == "excellent"

    delete_response = client.delete(f"/api/harvest-logs/{entry_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/harvest-logs/{entry_id}").status_code == 404


def test_list_harvest_logs_filters_by_planting(client: TestClient, db_session) -> None:
    planting_a = _create_planting(client, db_session, "test-tomato")
    planting_b = _create_planting(client, db_session, "test-pepper")

    entry_a = client.post(
        "/api/harvest-logs", json={"planting_id": planting_a, "harvest_date": "2027-08-01"}
    ).json()["id"]
    client.post("/api/harvest-logs", json={"planting_id": planting_b, "harvest_date": "2027-08-05"})

    response = client.get("/api/harvest-logs", params={"planting_id": planting_a})
    assert response.status_code == 200
    ids = [e["id"] for e in response.json()]
    assert ids == [entry_a]


def test_harvest_log_without_yield_or_quality_is_valid(client: TestClient, db_session) -> None:
    planting_id = _create_planting(client, db_session)
    response = client.post(
        "/api/harvest-logs", json={"planting_id": planting_id, "harvest_date": "2027-08-01"}
    )
    assert response.status_code == 201, response.text
    assert response.json()["yield_amount"] is None
    assert response.json()["quality"] is None
