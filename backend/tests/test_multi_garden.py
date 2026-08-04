"""#238: real multi-garden support - Garden.is_active, list-style
/api/gardens CRUD + /activate, garden_id resolution on Bed/GardenPlan
create, and garden deletion refusal (active/only garden)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_first_garden_created_via_put_is_active(client: TestClient) -> None:
    response = client.put(
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
    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is True


def test_create_second_garden_starts_inactive_with_own_ground_bed(client: TestClient) -> None:
    first = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    assert first["is_active"] is True

    second_response = client.post(
        "/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)}
    )
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()
    assert second["is_active"] is False

    # #258: GET /api/beds is scoped to whichever garden is currently
    # active - only the first garden's own ground bed shows while it's
    # active, not the second garden's (created but never activated).
    beds_while_first_active = client.get("/api/beds").json()
    ground_beds_while_first_active = [b for b in beds_while_first_active if b["name"] == "Ground"]
    assert len(ground_beds_while_first_active) == 1
    assert ground_beds_while_first_active[0]["garden_id"] == first["id"]

    # Activating the second garden switches which ground bed is visible.
    client.post(f"/api/gardens/{second['id']}/activate")
    beds_while_second_active = client.get("/api/beds").json()
    ground_beds_while_second_active = [b for b in beds_while_second_active if b["name"] == "Ground"]
    assert len(ground_beds_while_second_active) == 1
    assert ground_beds_while_second_active[0]["garden_id"] == second["id"]


def test_activate_garden_switches_the_single_active_flag(client: TestClient) -> None:
    first = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    second = client.post(
        "/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)}
    ).json()

    activate_response = client.post(f"/api/gardens/{second['id']}/activate")
    assert activate_response.status_code == 200, activate_response.text
    assert activate_response.json()["is_active"] is True

    gardens = {g["id"]: g for g in client.get("/api/gardens").json()}
    assert gardens[second["id"]]["is_active"] is True
    assert gardens[first["id"]]["is_active"] is False

    # The legacy singular route now resolves to whichever garden is active.
    assert client.get("/api/garden").json()["id"] == second["id"]


def test_bed_create_with_no_garden_id_resolves_to_active_garden(client: TestClient) -> None:
    first = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    second = client.post(
        "/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)}
    ).json()
    client.post(f"/api/gardens/{second['id']}/activate")

    bed_response = client.post(
        "/api/beds",
        json={"name": "New Bed", "border_geometry": rectangle(width=70, height=200)},
        params={"is_initial_state": "true"},
    )
    assert bed_response.status_code == 201, bed_response.text
    assert bed_response.json()["garden_id"] == second["id"]
    assert bed_response.json()["garden_id"] != first["id"]


def test_bed_create_with_explicit_garden_id_is_respected(client: TestClient) -> None:
    first = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    second = client.post(
        "/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)}
    ).json()
    # first garden stays active - explicit garden_id on the bed should still
    # win over the active-garden resolution.
    bed_response = client.post(
        "/api/beds",
        json={
            "name": "New Bed",
            "border_geometry": rectangle(width=70, height=200),
            "garden_id": second["id"],
        },
        params={"is_initial_state": "true"},
    )
    assert bed_response.status_code == 201, bed_response.text
    assert bed_response.json()["garden_id"] == second["id"]
    assert bed_response.json()["garden_id"] != first["id"]


def test_bed_create_with_no_garden_at_all_leaves_garden_id_null(client: TestClient) -> None:
    """No Garden exists yet - the same "just create the bed" flow every
    existing bed test (and app/scripts/import_example_garden.py, before its
    own Garden get-or-create runs) already relies on must keep working
    unchanged, just with a null garden_id rather than an error."""
    bed_response = client.post(
        "/api/beds", json={"name": "Standalone Bed", "border_geometry": rectangle()}
    )
    assert bed_response.status_code == 201, bed_response.text
    assert bed_response.json()["garden_id"] is None


def test_garden_plan_create_with_no_garden_id_resolves_to_active_garden(client: TestClient) -> None:
    active = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()

    plan_response = client.post("/api/garden-plans", json={"season_name": "Summer 2027", "year": 2027})
    assert plan_response.status_code == 201, plan_response.text
    assert plan_response.json()["garden_id"] == active["id"]


def test_delete_garden_refused_when_active(client: TestClient) -> None:
    first = client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    client.post("/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)})

    response = client.delete(f"/api/gardens/{first['id']}")
    assert response.status_code == 409
    assert client.get(f"/api/gardens/{first['id']}").status_code == 200


def test_delete_garden_refused_when_only_garden(client: TestClient) -> None:
    only = client.put(
        "/api/garden", json={"name": "Only Garden", "border_geometry": rectangle(width=500, height=500)}
    ).json()

    response = client.delete(f"/api/gardens/{only['id']}")
    assert response.status_code == 409
    assert client.get(f"/api/gardens/{only['id']}").status_code == 200


def test_delete_inactive_non_only_garden_succeeds_when_no_dependents(client: TestClient, db_session) -> None:
    client.put(
        "/api/garden", json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500)}
    ).json()
    second = client.post(
        "/api/gardens", json={"name": "Garden Two", "border_geometry": rectangle(width=300, height=300)}
    ).json()

    # Delete the auto-created ground bed first - a real FK, not the
    # active/only-garden 409 check, would otherwise block this. Found via a
    # direct DB query (not GET /api/beds, which #258 now scopes to the
    # *active* garden - first, not second, here) rather than switching the
    # active garden back and forth just to look this up.
    from app.models.bed import Bed as BedTable
    from sqlmodel import select

    ground_bed = db_session.exec(
        select(BedTable).where(BedTable.garden_id == second["id"], BedTable.name == "Ground")
    ).one()
    assert client.delete(f"/api/beds/{ground_bed.id}", params={"cascade": "true"}).status_code == 204

    response = client.delete(f"/api/gardens/{second['id']}")
    assert response.status_code == 204, response.text
    assert client.get(f"/api/gardens/{second['id']}").status_code == 404


def test_garden_write_body_cannot_set_is_active_directly(client: TestClient) -> None:
    """is_active is only ever settable via POST /api/gardens/{id}/activate -
    PUT/POST bodies that happen to include it are ignored, not honored,
    otherwise an ordinary PUT that omits it could silently deactivate
    whichever garden is currently active."""
    response = client.put(
        "/api/garden",
        json={"name": "Garden One", "border_geometry": rectangle(width=500, height=500), "is_active": False},
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is True
