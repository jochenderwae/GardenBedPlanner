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
        json={"action_type": "sow", "due_date": "2027-03-15", "notes": "start seeds indoors"},
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
        "/api/actions", json={"action_type": "harvest", "due_date": "2027-07-01"}
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
        "/api/actions", json={"action_type": "harvest", "due_date": "2027-07-01"}
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
            "due_date": "2027-04-01",
            "bed_id": bed_id,
            "plant_slug": "test-carrot",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["bed_id"] == bed_id
    assert response.json()["plant_slug"] == "test-carrot"


def test_list_actions_filters_by_due_date_range(client: TestClient) -> None:
    client.post("/api/actions", json={"action_type": "sow", "due_date": "2027-01-01"})
    in_range_id = client.post(
        "/api/actions", json={"action_type": "harvest", "due_date": "2027-06-15"}
    ).json()["id"]
    client.post("/api/actions", json={"action_type": "clear", "due_date": "2027-12-01"})

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
