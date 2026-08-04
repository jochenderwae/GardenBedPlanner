"""GET /api/garden 404-before-first-PUT contract, and PUT create/update
(get-or-create) semantics - including the one-time auto-created "Ground"
Bed side effect (see app/api/routes/garden.py's put_garden docstring)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_get_garden_404_before_first_put(client: TestClient) -> None:
    response = client.get("/api/garden")
    assert response.status_code == 404


def test_put_garden_creates_then_updates(client: TestClient) -> None:
    create_response = client.put(
        "/api/garden",
        json={
            "name": "My Garden",
            "border_geometry": rectangle(width=1000, height=800),
            "climate_zone": "8b",
            "location": "Belgium",
            "orientation_deg": 15.0,
            "notes": "",
        },
    )
    assert create_response.status_code == 200, create_response.text
    garden = create_response.json()
    assert garden["name"] == "My Garden"
    assert garden["orientation_deg"] == 15.0

    # First creation auto-creates a matching ground-level Bed.
    beds = client.get("/api/beds").json()
    assert any(b["name"] == "Ground" for b in beds)
    ground_bed_count = sum(1 for b in beds if b["name"] == "Ground")
    assert ground_bed_count == 1

    update_response = client.put(
        "/api/garden",
        json={
            "name": "My Garden",
            "border_geometry": rectangle(width=1200, height=900),
            "climate_zone": "8b",
            "location": "Belgium",
            "orientation_deg": 30.0,
            "notes": "updated",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["orientation_deg"] == 30.0
    assert update_response.json()["notes"] == "updated"

    # Second PUT must not create a second ground bed.
    beds_after_update = client.get("/api/beds").json()
    assert sum(1 for b in beds_after_update if b["name"] == "Ground") == 1


def test_delete_garden_404_when_none_exists(client: TestClient) -> None:
    response = client.delete("/api/garden")
    assert response.status_code == 404


def test_delete_garden_removes_it_and_put_recreates_cleanly(client: TestClient) -> None:
    """#218: the whole point of this route is unconditional e2e-fixture
    cleanup - no active/only-garden refusal the way DELETE
    /api/gardens/{id} (#238) has. Also confirms the auto-created ground Bed
    (put_garden's own #238 side effect) is cleaned up too, not just the
    Garden row itself - otherwise this route would 409 on its own
    auto-created dependent on literally every real call, defeating the
    whole point (a garden with no ground bed doesn't really happen in
    practice)."""
    garden_id = client.put(
        "/api/garden",
        json={"name": "Leaked Fixture Garden", "border_geometry": rectangle(width=500, height=500)},
    ).json()["id"]
    assert client.get("/api/garden").status_code == 200
    ground_bed_id = next(b["id"] for b in client.get("/api/beds").json() if b["garden_id"] == garden_id)

    delete_response = client.delete("/api/garden")
    assert delete_response.status_code == 204
    assert client.get("/api/garden").status_code == 404
    assert client.get(f"/api/beds/{ground_bed_id}").status_code == 404

    # A later spec's own PUT must be able to start clean afterward, not
    # trip over anything the deleted garden left behind.
    recreate_response = client.put(
        "/api/garden",
        json={"name": "Fresh Garden", "border_geometry": rectangle(width=300, height=300)},
    )
    assert recreate_response.status_code == 200, recreate_response.text
    assert recreate_response.json()["is_active"] is True


def test_delete_garden_cascades_extra_beds_and_garden_plans(client: TestClient) -> None:
    """A spec's own additional Beds (with real Plantings/Actions under
    them) and GardenPlans against the same garden must all get cleaned up
    too, not just the auto-created ground Bed - the same cascade
    cascade_delete_bed_dependents already gives DELETE /api/beds/{id}
    ?cascade=true, applied to every Bed under the garden being deleted."""
    garden_id = client.put(
        "/api/garden",
        json={"name": "Garden With Content", "border_geometry": rectangle(width=1000, height=1000)},
    ).json()["id"]

    extra_bed_response = client.post(
        "/api/beds", json={"name": "Extra Bed", "border_geometry": rectangle(width=70, height=200)}
    )
    assert extra_bed_response.status_code == 201, extra_bed_response.text
    extra_bed = extra_bed_response.json()
    assert extra_bed["garden_id"] == garden_id
    # A real prepare_bed Action gets auto-generated for this bed (#192).
    assert any(
        a["bed_id"] == extra_bed["id"] and a["action_type"] == "prepare_bed"
        for a in client.get("/api/actions").json()
    )

    plan_response = client.post("/api/garden-plans", json={"season_name": "Summer 2027", "year": 2027})
    assert plan_response.status_code == 201, plan_response.text
    plan = plan_response.json()
    assert plan["garden_id"] == garden_id

    delete_response = client.delete("/api/garden")
    assert delete_response.status_code == 204, delete_response.text

    assert client.get(f"/api/beds/{extra_bed['id']}").status_code == 404
    assert client.get(f"/api/garden-plans/{plan['id']}").status_code == 404
    assert [a for a in client.get("/api/actions").json() if a["bed_id"] == extra_bed["id"]] == []
