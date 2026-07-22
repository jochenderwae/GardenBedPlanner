"""Full CRUD round trip for /api/beds, plus the 404 contract and
rectangle<->polygon border_geometry round-trips (see docs/testing-plan.md
Phase 1's "Highest-value first tests" list)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_get_missing_bed_404(client: TestClient) -> None:
    response = client.get("/api/beds/999999")
    assert response.status_code == 404


def test_bed_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/beds",
        json={
            "name": "Test Bed",
            "category": "large_planter",
            "border_geometry": rectangle(width=70, height=200),
            "height_cm": 70,
            "has_greenhouse": False,
            "soil_type": "loam",
            "sun_level": "full_sun",
            "notes": "",
        },
    )
    assert create_response.status_code == 201, create_response.text
    bed = create_response.json()
    assert bed["name"] == "Test Bed"
    assert bed["border_geometry"]["type"] == "rectangle"
    bed_id = bed["id"]

    get_response = client.get(f"/api/beds/{bed_id}")
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Test Bed"

    list_response = client.get("/api/beds")
    assert list_response.status_code == 200
    assert any(b["id"] == bed_id for b in list_response.json())

    update_response = client.patch(f"/api/beds/{bed_id}", json={"name": "Renamed Bed"})
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Renamed Bed"
    # Untouched fields survive a partial PATCH.
    assert update_response.json()["category"] == "large_planter"

    delete_response = client.delete(f"/api/beds/{bed_id}")
    assert delete_response.status_code == 204

    assert client.get(f"/api/beds/{bed_id}").status_code == 404


def test_bed_border_geometry_polygon_round_trip(client: TestClient) -> None:
    polygon = {
        "type": "polygon",
        "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 50, "y": 100}],
    }
    create_response = client.post(
        "/api/beds",
        json={"name": "Triangular Bed", "border_geometry": polygon},
    )
    assert create_response.status_code == 201, create_response.text
    assert create_response.json()["border_geometry"] == polygon

    bed_id = create_response.json()["id"]
    get_response = client.get(f"/api/beds/{bed_id}")
    assert get_response.json()["border_geometry"] == polygon


def test_delete_bed_without_cascade_conflicts_when_referenced(client: TestClient, db_session) -> None:
    """#82's own "How to test" step 1 explicitly asks to confirm the bed is
    *untouched* by a 409, not just that the response code is 409 - the bed
    (and its dependent planting) must still be there afterward, ready for a
    retry (with or without cascade), not left in some half-deleted state."""
    from app.models.plant import Plant
    from app.models.planting import Planting

    bed_id = client.post(
        "/api/beds", json={"name": "Occupied Bed", "border_geometry": rectangle()}
    ).json()["id"]

    db_session.add(Plant(slug="test-tomato", common_name="Tomato", botanical_name="Solanum lycopersicum"))
    db_session.commit()
    db_session.add(Planting(bed_id=bed_id, plant_slug="test-tomato", geometry=rectangle(width=20, height=20)))
    db_session.commit()

    conflict_response = client.delete(f"/api/beds/{bed_id}")
    assert conflict_response.status_code == 409

    assert client.get(f"/api/beds/{bed_id}").status_code == 200
    assert len(client.get("/api/plantings").json()) == 1

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204
    assert client.get(f"/api/beds/{bed_id}").status_code == 404


def test_cascade_delete_actually_removes_dependent_plantings_and_equipment(client: TestClient, db_session) -> None:
    """The earlier round-trip test only confirms the *bed* is gone after a
    cascade delete - this confirms the dependent rows it was supposed to
    take with it (a Planting and a BedEquipment row) are actually gone too,
    not just orphaned with a now-dangling bed_id."""
    from app.models.plant import Plant
    from app.models.planting import Planting

    bed_id = client.post(
        "/api/beds", json={"name": "Fully Occupied Bed", "border_geometry": rectangle()}
    ).json()["id"]

    db_session.add(Plant(slug="test-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()
    db_session.add(Planting(bed_id=bed_id, plant_slug="test-carrot", geometry=rectangle(width=20, height=20)))
    db_session.commit()
    planting_id = next(p["id"] for p in client.get("/api/plantings").json() if p["bed_id"] == bed_id)

    equipment_response = client.post(
        "/api/bed-equipment",
        json={"bed_id": bed_id, "equipment_type": "trellis", "geometry": rectangle(width=10, height=10)},
    )
    assert equipment_response.status_code == 201, equipment_response.text
    equipment_id = equipment_response.json()["id"]

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204

    assert client.get(f"/api/plantings/{planting_id}").status_code == 404
    assert client.get(f"/api/bed-equipment/{equipment_id}").status_code == 404


def test_delete_bed_with_no_dependents_works_the_same_with_or_without_cascade(client: TestClient) -> None:
    without_cascade_id = client.post(
        "/api/beds", json={"name": "Empty Bed A", "border_geometry": rectangle()}
    ).json()["id"]
    assert client.delete(f"/api/beds/{without_cascade_id}").status_code == 204
    assert client.get(f"/api/beds/{without_cascade_id}").status_code == 404

    with_cascade_id = client.post(
        "/api/beds", json={"name": "Empty Bed B", "border_geometry": rectangle()}
    ).json()["id"]
    assert client.delete(f"/api/beds/{with_cascade_id}", params={"cascade": "true"}).status_code == 204
    assert client.get(f"/api/beds/{with_cascade_id}").status_code == 404
