"""GardenPlan + GardenPlanEntry CRUD (see app/models/garden_plan.py,
app/api/routes/garden_plans.py) - a season/year plant wishlist, distinct
from the real Planting records."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_plant(db_session, slug: str = "test-tomato") -> str:
    db_session.add(Plant(slug=slug, common_name="Tomato", botanical_name="Solanum lycopersicum"))
    db_session.commit()
    return slug


def test_get_missing_garden_plan_404(client: TestClient) -> None:
    assert client.get("/api/garden-plans/999999").status_code == 404


def test_garden_plan_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/garden-plans", json={"season_name": "Summer 2027", "year": 2027, "notes": "first pass"}
    )
    assert create_response.status_code == 201, create_response.text
    plan = create_response.json()
    assert plan["season_name"] == "Summer 2027"
    plan_id = plan["id"]

    get_response = client.get(f"/api/garden-plans/{plan_id}")
    assert get_response.status_code == 200
    assert get_response.json()["entries"] == []

    list_response = client.get("/api/garden-plans")
    assert any(p["id"] == plan_id for p in list_response.json())

    update_response = client.patch(f"/api/garden-plans/{plan_id}", json={"notes": "revised"})
    assert update_response.status_code == 200
    assert update_response.json()["notes"] == "revised"
    assert update_response.json()["year"] == 2027

    delete_response = client.delete(f"/api/garden-plans/{plan_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/garden-plans/{plan_id}").status_code == 404


def test_garden_plan_entry_round_trip_with_and_without_bed(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    bed_id = client.post(
        "/api/beds", json={"name": "Bed", "border_geometry": rectangle()}
    ).json()["id"]
    plan_id = client.post(
        "/api/garden-plans", json={"season_name": "Summer 2027", "year": 2027}
    ).json()["id"]

    unassigned_response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 4},
    )
    assert unassigned_response.status_code == 201, unassigned_response.text
    unassigned_entry = unassigned_response.json()
    assert unassigned_entry["bed_id"] is None

    assigned_response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "bed_id": bed_id, "desired_quantity": 2},
    )
    assert assigned_response.status_code == 201, assigned_response.text
    assigned_entry_id = assigned_response.json()["id"]

    plan_detail = client.get(f"/api/garden-plans/{plan_id}").json()
    assert len(plan_detail["entries"]) == 2

    list_entries_response = client.get(f"/api/garden-plans/{plan_id}/entries")
    assert len(list_entries_response.json()) == 2

    update_response = client.patch(
        f"/api/garden-plans/{plan_id}/entries/{assigned_entry_id}",
        json={"desired_quantity": 3, "bed_id": None},
    )
    assert update_response.status_code == 200
    assert update_response.json()["desired_quantity"] == 3
    assert update_response.json()["bed_id"] is None

    delete_response = client.delete(f"/api/garden-plans/{plan_id}/entries/{assigned_entry_id}")
    assert delete_response.status_code == 204
    assert len(client.get(f"/api/garden-plans/{plan_id}/entries").json()) == 1


def test_garden_plan_entry_404_for_wrong_plan(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    plan_a_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    plan_b_id = client.post("/api/garden-plans", json={"season_name": "B", "year": 2027}).json()["id"]

    entry_id = client.post(
        f"/api/garden-plans/{plan_a_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    ).json()["id"]

    # entries have no standalone GET, but PATCH/DELETE scoped to the wrong
    # plan must still 404 rather than silently acting across plans.
    assert client.patch(
        f"/api/garden-plans/{plan_b_id}/entries/{entry_id}", json={"desired_quantity": 5}
    ).status_code == 404
    assert client.delete(f"/api/garden-plans/{plan_b_id}/entries/{entry_id}").status_code == 404


def test_create_garden_plan_entry_bad_plant_slug_returns_409(client: TestClient) -> None:
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": "no-such-plant", "desired_quantity": 1},
    )
    assert response.status_code == 409


def test_delete_garden_plan_without_cascade_conflicts_when_it_has_entries(
    client: TestClient, db_session
) -> None:
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    )

    conflict_response = client.delete(f"/api/garden-plans/{plan_id}")
    assert conflict_response.status_code == 409

    cascade_response = client.delete(f"/api/garden-plans/{plan_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204
    assert client.get(f"/api/garden-plans/{plan_id}").status_code == 404
