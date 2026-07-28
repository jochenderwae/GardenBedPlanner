"""Action CRUD (see app/models/action.py, app/api/routes/actions.py) -
generic garden work items, plus the due_from/due_to/status/action_type
list filters and the auto-complete-status-on-completed_date behavior."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_get_missing_action_404(client: TestClient) -> None:
    assert client.get("/api/actions/999999").status_code == 404


def test_action_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/actions",
        json={
            "action_type": "sow",
            "due_date_start": "2027-03-01",
            "due_date_end": "2027-03-15",
            "notes": "start seeds indoors",
        },
    )
    assert create_response.status_code == 201, create_response.text
    action = create_response.json()
    assert action["status"] == "pending"
    assert action["completed_date"] is None
    action_id = action["id"]

    get_response = client.get(f"/api/actions/{action_id}")
    assert get_response.status_code == 200
    assert get_response.json()["action_type"] == "sow"

    delete_response = client.delete(f"/api/actions/{action_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/actions/{action_id}").status_code == 404


def test_setting_completed_date_defaults_status_to_completed(client: TestClient) -> None:
    action_id = client.post(
        "/api/actions", json={"action_type": "harvest", "due_date_end": "2027-07-01"}
    ).json()["id"]

    update_response = client.patch(
        f"/api/actions/{action_id}", json={"completed_date": "2027-07-02"}
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["completed_date"] == "2027-07-02"
    assert body["status"] == "completed"


def test_explicit_status_overrides_completed_date_default(client: TestClient) -> None:
    action_id = client.post(
        "/api/actions", json={"action_type": "harvest", "due_date_end": "2027-07-01"}
    ).json()["id"]

    update_response = client.patch(
        f"/api/actions/{action_id}",
        json={"completed_date": "2027-07-02", "status": "skipped"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "skipped"


def test_action_without_any_bed_plant_equipment_reference_is_valid(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "compost"})
    assert response.status_code == 201, response.text
    assert response.json()["bed_id"] is None
    assert response.json()["plant_slug"] is None
    assert response.json()["equipment_id"] is None


def test_action_can_reference_a_bed_and_plant(client: TestClient, db_session) -> None:
    from app.models.plant import Plant

    bed_id = client.post(
        "/api/beds", json={"name": "Bed", "border_geometry": rectangle()}
    ).json()["id"]
    db_session.add(Plant(slug="test-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()

    response = client.post(
        "/api/actions",
        json={
            "action_type": "sow",
            "due_date_start": "2027-04-01",
            "due_date_end": "2027-04-01",
            "bed_id": bed_id,
            "plant_slug": "test-carrot",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["bed_id"] == bed_id
    assert response.json()["plant_slug"] == "test-carrot"


def test_list_actions_filters_by_due_date_range(client: TestClient) -> None:
    client.post(
        "/api/actions",
        json={"action_type": "sow", "due_date_start": "2027-01-01", "due_date_end": "2027-01-01"},
    )
    in_range_id = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_start": "2027-06-15", "due_date_end": "2027-06-15"},
    ).json()["id"]
    client.post(
        "/api/actions",
        json={"action_type": "clear", "due_date_start": "2027-12-01", "due_date_end": "2027-12-01"},
    )

    response = client.get(
        "/api/actions", params={"due_from": "2027-05-01", "due_to": "2027-07-01"}
    )
    assert response.status_code == 200
    ids = [a["id"] for a in response.json()]
    assert ids == [in_range_id]


def test_list_actions_filters_by_status_and_type(client: TestClient) -> None:
    sow_id = client.post("/api/actions", json={"action_type": "sow"}).json()["id"]
    harvest_id = client.post("/api/actions", json={"action_type": "harvest"}).json()["id"]
    client.patch(f"/api/actions/{harvest_id}", json={"status": "skipped"})

    by_type = client.get("/api/actions", params={"action_type": "sow"}).json()
    assert [a["id"] for a in by_type] == [sow_id]

    by_status = client.get("/api/actions", params={"status": "skipped"}).json()
    assert [a["id"] for a in by_status] == [harvest_id]


def test_patch_missing_action_404(client: TestClient) -> None:
    response = client.patch("/api/actions/999999", json={"status": "completed"})
    assert response.status_code == 404


def test_delete_missing_action_404(client: TestClient) -> None:
    assert client.delete("/api/actions/999999").status_code == 404


def test_create_action_requires_action_type(client: TestClient) -> None:
    assert client.post("/api/actions", json={}).status_code == 422


def test_create_action_rejects_an_invalid_action_type(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "not-a-real-type"})
    assert response.status_code == 422


def test_create_action_bad_bed_id_returns_409(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "compost", "bed_id": 999999})
    assert response.status_code == 409


def test_create_action_bad_plant_slug_returns_409(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "sow", "plant_slug": "no-such-plant"})
    assert response.status_code == 409


def test_create_action_bad_equipment_id_returns_409(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "install_equipment", "equipment_id": 999999})
    assert response.status_code == 409


def test_create_action_bad_garden_plan_entry_id_returns_409(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "sow", "garden_plan_entry_id": 999999})
    assert response.status_code == 409


def test_due_date_range_filter_is_inclusive_on_both_ends(client: TestClient) -> None:
    on_from_boundary = client.post(
        "/api/actions",
        json={"action_type": "sow", "due_date_start": "2027-05-01", "due_date_end": "2027-05-01"},
    ).json()["id"]
    on_to_boundary = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_start": "2027-07-01", "due_date_end": "2027-07-01"},
    ).json()["id"]
    just_outside_from = client.post(
        "/api/actions",
        json={"action_type": "sow", "due_date_start": "2027-04-30", "due_date_end": "2027-04-30"},
    ).json()["id"]
    just_outside_to = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_start": "2027-07-02", "due_date_end": "2027-07-02"},
    ).json()["id"]

    response = client.get("/api/actions", params={"due_from": "2027-05-01", "due_to": "2027-07-01"})
    ids = {a["id"] for a in response.json()}
    assert on_from_boundary in ids
    assert on_to_boundary in ids
    assert just_outside_from not in ids
    assert just_outside_to not in ids


def test_clearing_completed_date_back_to_null_does_not_revert_status(client: TestClient) -> None:
    """The completed_date-defaults-status behavior only fires when
    *setting* a non-null completed_date without an explicit status in the
    same request - clearing it back to null isn't the same event and must
    not have any special-cased reverse effect (documents actual behavior,
    since the route has no such reverse logic at all)."""
    action_id = client.post("/api/actions", json={"action_type": "harvest"}).json()["id"]
    client.patch(f"/api/actions/{action_id}", json={"completed_date": "2027-07-02"})
    assert client.get(f"/api/actions/{action_id}").json()["status"] == "completed"

    response = client.patch(f"/api/actions/{action_id}", json={"completed_date": None})
    assert response.status_code == 200
    assert response.json()["completed_date"] is None
    assert response.json()["status"] == "completed"  # unchanged, no auto-revert to pending


def test_deleting_a_bed_referenced_by_an_action_returns_409_not_500(client: TestClient) -> None:
    bed_id = client.post("/api/beds", json={"name": "Bed", "border_geometry": rectangle()}).json()["id"]
    client.post("/api/actions", json={"action_type": "prepare_bed", "bed_id": bed_id})

    response = client.delete(f"/api/beds/{bed_id}")
    assert response.status_code == 409


def test_deleting_equipment_referenced_by_an_action_returns_409_not_500(client: TestClient) -> None:
    bed_id = client.post("/api/beds", json={"name": "Bed", "border_geometry": rectangle()}).json()["id"]
    equipment_id = client.post(
        "/api/bed-equipment", json={"bed_id": bed_id, "equipment_type": "drip_line"}
    ).json()["id"]
    client.post("/api/actions", json={"action_type": "install_equipment", "equipment_id": equipment_id})

    response = client.delete(f"/api/bed-equipment/{equipment_id}")
    assert response.status_code == 409


def test_deleting_a_garden_plan_entry_referenced_by_an_action_returns_409_not_500(
    client: TestClient, db_session
) -> None:
    from app.models.plant import Plant

    db_session.add(Plant(slug="test-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    entry_id = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": "test-carrot", "desired_quantity": 1},
    ).json()["id"]
    client.post("/api/actions", json={"action_type": "sow", "garden_plan_entry_id": entry_id})

    response = client.delete(f"/api/garden-plans/{plan_id}/entries/{entry_id}")
    assert response.status_code == 409


def test_deleting_a_plant_referenced_by_an_action_returns_409_not_500(client: TestClient, db_session) -> None:
    """KNOWN REAL BUG, same root cause already reported on #28 - see that
    issue's tester comment for the full diagnosis (plants.py's delete_plant
    uses a Core-style bulk `session.exec(delete(PlantTable)...)` for the
    Plant row itself, which bypasses commit_or_409's try/except since
    Postgres checks the FK violation immediately, not deferred to
    session.commit()). #30 didn't introduce this bug - Action.plant_slug is
    just another FK reference that trips over the identical pre-existing
    defect, the same way #28's garden_plan_entry.plant_slug did. Not
    re-filing a duplicate - flagging in the tester summary comment on #30
    that the fix for #28 will resolve this too. Left failing on purpose."""
    from app.models.plant import Plant

    db_session.add(Plant(slug="test-carrot", common_name="Carrot", botanical_name="Daucus carota"))
    db_session.commit()
    client.post("/api/actions", json={"action_type": "sow", "plant_slug": "test-carrot"})

    response = client.delete("/api/plants/test-carrot")
    assert response.status_code == 409
