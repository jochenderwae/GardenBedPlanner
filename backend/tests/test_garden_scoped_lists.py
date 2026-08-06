"""#258: list endpoints (beds/plantings/actions/bed-equipment/compost-bins/
compost-fertilization-logs/harvest-logs/garden-plans) scope their results to
whichever garden is currently active, mirroring the create-time garden_id
resolution #238 already gave POST /api/beds and POST /api/garden-plans.
Covers this ticket's own "How to test" steps (create a second garden, add a
bed to each, activate one/the other, confirm GET /api/beds and
GET /api/plantings return only the active garden's own rows) plus the
transitively-scoped satellite resources (Action, BedEquipment, CompostBin,
CompostFertilizationLog, HarvestLog) the ticket's "Proposed fix" section also
calls out."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _make_garden(client: TestClient, name: str, *, activate: bool = False) -> dict:
    if not activate:
        # First-ever garden via PUT is always auto-activated - only useful
        # for the very first garden of a test.
        return client.post(
            "/api/gardens", json={"name": name, "border_geometry": rectangle(width=300, height=300)}
        ).json()
    garden = client.put(
        "/api/garden", json={"name": name, "border_geometry": rectangle(width=300, height=300)}
    ).json()
    return garden


def _add_bed(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/beds",
        json={"name": name, "border_geometry": rectangle(width=70, height=200)},
        params={"is_initial_state": "true"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_beds_and_plantings_scope_to_the_active_garden(client: TestClient, db_session) -> None:
    garden_a = _make_garden(client, "Garden A", activate=True)
    bed_a = _add_bed(client, "Bed A")

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    bed_b = _add_bed(client, "Bed B")

    db_session.add(Plant(slug="test-258-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()
    planting_b = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_b["id"],
            "plant_slug": "test-258-carrot",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert planting_b.status_code == 201, planting_b.text

    # Garden B is active - only its own bed/planting show.
    beds_b = client.get("/api/beds").json()
    assert bed_b["id"] in {b["id"] for b in beds_b}
    assert bed_a["id"] not in {b["id"] for b in beds_b}
    plantings_b = client.get("/api/plantings").json()
    assert any(p["bed_id"] == bed_b["id"] for p in plantings_b)

    # Switching to garden A flips which bed shows, and hides B's planting.
    client.post(f"/api/gardens/{garden_a['id']}/activate")
    beds_a = client.get("/api/beds").json()
    assert bed_a["id"] in {b["id"] for b in beds_a}
    assert bed_b["id"] not in {b["id"] for b in beds_a}
    plantings_a = client.get("/api/plantings").json()
    assert all(p["bed_id"] != bed_b["id"] for p in plantings_a)


def test_actions_scope_transitively_via_bed_but_bedless_actions_always_show(
    client: TestClient,
) -> None:
    _make_garden(client, "Garden A", activate=True)
    bed_a = _add_bed(client, "Bed A")
    action_a = client.post("/api/actions", json={"action_type": "prepare_bed", "bed_id": bed_a["id"]})
    assert action_a.status_code == 201, action_a.text

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    bed_b = _add_bed(client, "Bed B")
    action_b = client.post("/api/actions", json={"action_type": "prepare_bed", "bed_id": bed_b["id"]})
    assert action_b.status_code == 201, action_b.text

    # A general compost-turn action with no bed at all.
    general_action = client.post("/api/actions", json={"action_type": "compost"})
    assert general_action.status_code == 201, general_action.text

    actions_while_b_active = client.get("/api/actions").json()
    action_ids_seen = {a["id"] for a in actions_while_b_active}
    assert action_b.json()["id"] in action_ids_seen
    assert action_a.json()["id"] not in action_ids_seen
    # The bedless action isn't hidden just because a garden is active.
    assert general_action.json()["id"] in action_ids_seen


def test_garden_plans_scope_to_the_active_garden(client: TestClient) -> None:
    garden_a = _make_garden(client, "Garden A", activate=True)
    plan_a = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    plan_b = client.post("/api/garden-plans", json={"season_name": "B", "year": 2027}).json()

    plans_while_b_active = {p["id"] for p in client.get("/api/garden-plans").json()}
    assert plan_b["id"] in plans_while_b_active
    assert plan_a["id"] not in plans_while_b_active

    client.post(f"/api/gardens/{garden_a['id']}/activate")
    plans_while_a_active = {p["id"] for p in client.get("/api/garden-plans").json()}
    assert plan_a["id"] in plans_while_a_active
    assert plan_b["id"] not in plans_while_a_active


def test_bed_equipment_scopes_via_bed_or_garden_id_but_unplaced_inventory_always_shows(
    client: TestClient,
) -> None:
    _make_garden(client, "Garden A", activate=True)
    bed_a = _add_bed(client, "Bed A")
    equipment_a = client.post(
        "/api/bed-equipment", json={"bed_id": bed_a["id"], "equipment_type": "trellis"}
    ).json()

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    bed_b = _add_bed(client, "Bed B")
    equipment_b_bed = client.post(
        "/api/bed-equipment", json={"bed_id": bed_b["id"], "equipment_type": "drip_line"}
    ).json()
    equipment_b_garden = client.post(
        "/api/bed-equipment", json={"garden_id": garden_b["id"], "equipment_type": "rain_barrel"}
    ).json()
    unplaced = client.post("/api/bed-equipment", json={"equipment_type": "stake"}).json()

    listed_ids = {e["id"] for e in client.get("/api/bed-equipment").json()}
    assert equipment_b_bed["id"] in listed_ids
    assert equipment_b_garden["id"] in listed_ids
    assert unplaced["id"] in listed_ids
    assert equipment_a["id"] not in listed_ids


def test_compost_bins_and_fertilization_logs_scope_via_bed(client: TestClient) -> None:
    _make_garden(client, "Garden A", activate=True)
    bed_a = _add_bed(client, "Bed A")
    client.post("/api/compost-bins", json={"bed_id": bed_a["id"]})
    client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_a["id"], "log_date": "2027-04-01", "type": "compost"},
    )

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    bed_b = _add_bed(client, "Bed B")
    bin_b = client.post("/api/compost-bins", json={"bed_id": bed_b["id"]}).json()
    log_b = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_b["id"], "log_date": "2027-04-01", "type": "fertilizer"},
    ).json()

    bins_while_b_active = {b["id"] for b in client.get("/api/compost-bins").json()}
    assert bins_while_b_active == {bin_b["id"]}
    logs_while_b_active = {log["id"] for log in client.get("/api/compost-fertilization-logs").json()}
    assert logs_while_b_active == {log_b["id"]}


def test_harvest_logs_scope_transitively_via_planting_and_bed(client: TestClient, db_session) -> None:
    db_session.add(Plant(slug="test-258-pepper", common_name="Pepper", botanical_name="Capsicum"))
    db_session.commit()

    _make_garden(client, "Garden A", activate=True)
    bed_a = _add_bed(client, "Bed A")
    planting_a = client.post(
        "/api/plantings",
        json={"bed_id": bed_a["id"], "plant_slug": "test-258-pepper", "geometry": rectangle(width=20, height=20)},
    ).json()
    client.post(
        "/api/harvest-logs", json={"planting_id": planting_a["id"], "harvest_date": "2027-08-01"}
    )

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    bed_b = _add_bed(client, "Bed B")
    planting_b = client.post(
        "/api/plantings",
        json={"bed_id": bed_b["id"], "plant_slug": "test-258-pepper", "geometry": rectangle(width=20, height=20)},
    ).json()
    log_b = client.post(
        "/api/harvest-logs", json={"planting_id": planting_b["id"], "harvest_date": "2027-08-01"}
    ).json()

    logs_while_b_active = {log["id"] for log in client.get("/api/harvest-logs").json()}
    assert logs_while_b_active == {log_b["id"]}


def test_decorations_scope_to_the_active_garden(client: TestClient) -> None:
    """#266: Decoration gained garden_id after the fact (unlike Bed/GardenPlan,
    scoped from the start by #238) - confirms GET /api/decorations follows the
    same active-garden filtering as every other garden-owned list route, and
    that POST resolves garden_id server-side against whichever garden is
    active at creation time, exactly like create_bed."""
    garden_a = _make_garden(client, "Garden A", activate=True)
    decoration_a = client.post(
        "/api/decorations", json={"name": "Stone bench", "border_geometry": rectangle(width=40, height=100)}
    ).json()
    assert decoration_a["garden_id"] == garden_a["id"]

    garden_b = _make_garden(client, "Garden B")
    client.post(f"/api/gardens/{garden_b['id']}/activate")
    decoration_b = client.post(
        "/api/decorations", json={"name": "Bird bath", "border_geometry": rectangle(width=30, height=30)}
    ).json()
    assert decoration_b["garden_id"] == garden_b["id"]

    decorations_while_b_active = {d["id"] for d in client.get("/api/decorations").json()}
    assert decoration_b["id"] in decorations_while_b_active
    assert decoration_a["id"] not in decorations_while_b_active

    client.post(f"/api/gardens/{garden_a['id']}/activate")
    decorations_while_a_active = {d["id"] for d in client.get("/api/decorations").json()}
    assert decoration_a["id"] in decorations_while_a_active
    assert decoration_b["id"] not in decorations_while_a_active

    # Explicit garden_id in the request body overrides active-garden resolution.
    decoration_explicit = client.post(
        "/api/decorations",
        json={
            "name": "Explicit-garden gnome",
            "border_geometry": rectangle(width=10, height=10),
            "garden_id": garden_b["id"],
        },
    ).json()
    assert decoration_explicit["garden_id"] == garden_b["id"]


def test_list_endpoints_stay_unfiltered_when_no_garden_exists_at_all(
    client: TestClient, db_session
) -> None:
    """No Garden row exists yet (get_active_garden returns None) - every
    pre-#238 flow (most existing bed/planting/action tests) must keep
    returning everything unfiltered, exactly as it did before multi-garden
    support existed."""
    bed = client.post(
        "/api/beds", json={"name": "Standalone Bed", "border_geometry": rectangle()}
    ).json()
    assert bed["garden_id"] is None
    assert bed["id"] in {b["id"] for b in client.get("/api/beds").json()}
