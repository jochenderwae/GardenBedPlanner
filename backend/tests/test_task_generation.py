"""Automatic Action (garden task) generation off Bed/Planting/BedEquipment
creation (#192, see app/services/task_generation.py and this issue's own
"How to test" list)."""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.models.plant import PeriodType, Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _ensure_period_type(db_session, code: str) -> None:
    # period_type is seeded once by a migration's own data insert (see
    # 0c586808f5c2), but tests truncate every app table after each test -
    # only whichever test happens to run first in the whole session still
    # sees that seed data, so every other test needs to (re)create the
    # codes it needs itself, idempotently.
    if db_session.get(PeriodType, code) is None:
        db_session.add(PeriodType(code=code, description=code))
        db_session.commit()


def _create_plant_with_periods(db_session, slug: str, periods: list[tuple[str, int, int]]) -> str:
    from app.models.plant import PlantPeriod

    db_session.add(Plant(slug=slug, common_name=slug, botanical_name=slug))
    db_session.commit()
    for period_type, start_month, end_month in periods:
        _ensure_period_type(db_session, period_type)
        db_session.add(
            PlantPeriod(
                plant_slug=slug, period_type=period_type, start_month=start_month, end_month=end_month
            )
        )
    db_session.commit()
    return slug


def _create_bed(client: TestClient, name: str = "Bed", is_initial_state: bool = False) -> int:
    response = client.post(
        "/api/beds",
        json={"name": name, "border_geometry": rectangle()},
        params={"is_initial_state": str(is_initial_state).lower()},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_planting_generates_sow_and_harvest_tasks_from_plant_periods(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, is_initial_state=True)
    plant_slug = _create_plant_with_periods(
        db_session, "test-tomato", [("sowing", 3, 4), ("harvesting", 7, 8)]
    )

    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2027-04-01",
        },
    )
    assert response.status_code == 201, response.text

    actions = client.get("/api/actions").json()
    by_type = {a["action_type"]: a for a in actions if a["bed_id"] == bed_id}

    assert by_type["sow"]["due_date_start"] == "2027-03-01"
    assert by_type["sow"]["due_date_end"] == "2027-04-30"
    assert by_type["harvest"]["due_date_start"] == "2027-07-01"
    assert by_type["harvest"]["due_date_end"] == "2027-08-31"


def test_initial_state_flag_skips_task_generation_for_planting(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, is_initial_state=True)
    plant_slug = _create_plant_with_periods(db_session, "test-basil", [("sowing", 3, 4)])

    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2027-04-01",
        },
        params={"is_initial_state": "true"},
    )
    assert response.status_code == 201, response.text

    actions = client.get("/api/actions").json()
    assert [a for a in actions if a["plant_slug"] == plant_slug] == []


def test_individual_plantings_same_bed_plant_date_collapse_into_one_task(
    client: TestClient, db_session
) -> None:
    bed_id = _create_bed(client, is_initial_state=True)
    plant_slug = _create_plant_with_periods(db_session, "test-carrot", [("sowing", 3, 4)])

    for _ in range(3):
        response = client.post(
            "/api/plantings",
            json={
                "bed_id": bed_id,
                "plant_slug": plant_slug,
                "placement_type": "individual",
                "geometry": rectangle(width=20, height=20),
                "planted_date": "2027-04-01",
            },
        )
        assert response.status_code == 201, response.text

    actions = client.get("/api/actions").json()
    sow_actions = [a for a in actions if a["plant_slug"] == plant_slug and a["action_type"] == "sow"]
    assert len(sow_actions) == 1


def test_setting_removed_date_generates_single_day_clear_task(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, is_initial_state=True)
    db_session.add(Plant(slug="test-lettuce", common_name="Lettuce", botanical_name="Lactuca sativa"))
    db_session.commit()

    planting_id = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": "test-lettuce",
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
        params={"is_initial_state": "true"},
    ).json()["id"]

    update_response = client.patch(
        f"/api/plantings/{planting_id}", json={"removed_date": "2027-06-15"}
    )
    assert update_response.status_code == 200

    actions = client.get("/api/actions").json()
    clear_actions = [a for a in actions if a["plant_slug"] == "test-lettuce" and a["action_type"] == "clear"]
    assert len(clear_actions) == 1
    assert clear_actions[0]["due_date_start"] == "2027-06-15"
    assert clear_actions[0]["due_date_end"] == "2027-06-15"


def test_started_from_seed_false_skips_sow_task(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, is_initial_state=True)
    plant_slug = _create_plant_with_periods(
        db_session, "test-pepper", [("sowing", 2, 3), ("planting", 4, 5)]
    )

    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2027-05-01",
        },
        params={"started_from_seed": "false"},
    )
    assert response.status_code == 201, response.text

    actions = client.get("/api/actions").json()
    types = {a["action_type"] for a in actions if a["plant_slug"] == plant_slug}
    assert "sow" not in types
    assert "plant" in types


def test_sow_task_depends_on_prepare_bed_task(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)  # not initial state - generates a prepare_bed task
    plant_slug = _create_plant_with_periods(db_session, "test-cucumber", [("sowing", 4, 5)])

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2027-05-01",
        },
    )

    actions = client.get("/api/actions").json()
    prepare_bed_action = next(a for a in actions if a["bed_id"] == bed_id and a["action_type"] == "prepare_bed")
    sow_action = next(a for a in actions if a["plant_slug"] == plant_slug and a["action_type"] == "sow")
    assert sow_action["depends_on_action_id"] == prepare_bed_action["id"]


def test_bed_creation_generates_prepare_bed_task_unless_initial_state(client: TestClient) -> None:
    today = date.today().isoformat()

    bed_id = _create_bed(client, name="Real bed")
    actions = client.get("/api/actions").json()
    prepare_bed_actions = [a for a in actions if a["bed_id"] == bed_id and a["action_type"] == "prepare_bed"]
    assert len(prepare_bed_actions) == 1
    assert prepare_bed_actions[0]["due_date_start"] == today
    assert prepare_bed_actions[0]["due_date_end"] == today

    initial_bed_id = _create_bed(client, name="Backfilled bed", is_initial_state=True)
    actions = client.get("/api/actions").json()
    assert [a for a in actions if a["bed_id"] == initial_bed_id] == []


def test_equipment_creation_generates_install_equipment_task_unless_initial_state(client: TestClient) -> None:
    bed_id = _create_bed(client, is_initial_state=True)

    equipment_response = client.post(
        "/api/bed-equipment",
        json={"bed_id": bed_id, "equipment_type": "trellis", "geometry": rectangle(width=10, height=10)},
    )
    assert equipment_response.status_code == 201, equipment_response.text
    equipment_id = equipment_response.json()["id"]

    actions = client.get("/api/actions").json()
    install_actions = [a for a in actions if a["equipment_id"] == equipment_id]
    assert len(install_actions) == 1
    assert install_actions[0]["action_type"] == "install_equipment"

    initial_equipment_id = client.post(
        "/api/bed-equipment",
        json={"bed_id": bed_id, "equipment_type": "stake", "geometry": rectangle(width=5, height=5)},
        params={"is_initial_state": "true"},
    ).json()["id"]
    actions = client.get("/api/actions").json()
    assert [a for a in actions if a["equipment_id"] == initial_equipment_id] == []


def test_unassigned_equipment_generates_no_install_task(client: TestClient) -> None:
    equipment_id = client.post(
        "/api/bed-equipment", json={"equipment_type": "trellis"}
    ).json()["id"]

    actions = client.get("/api/actions").json()
    assert [a for a in actions if a["equipment_id"] == equipment_id] == []


def test_actionable_now_orders_by_due_date_end_ascending(client: TestClient) -> None:
    today = date.today()
    past_start = (today.replace(day=1)).isoformat()

    far_deadline_id = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_start": past_start, "due_date_end": "2099-12-31"},
    ).json()["id"]
    near_deadline_id = client.post(
        "/api/actions",
        json={"action_type": "sow", "due_date_start": past_start, "due_date_end": "2099-01-01"},
    ).json()["id"]
    # Window hasn't opened yet - excluded even though its deadline is soon.
    client.post(
        "/api/actions",
        json={"action_type": "fertilize", "due_date_start": "2099-06-01", "due_date_end": "2099-06-02"},
    )
    # Already completed - excluded regardless of window.
    completed_id = client.post(
        "/api/actions",
        json={"action_type": "clear", "due_date_start": past_start, "due_date_end": "2099-06-15"},
    ).json()["id"]
    client.patch(f"/api/actions/{completed_id}", json={"completed_date": today.isoformat()})

    response = client.get("/api/actions", params={"actionable_now": "true"})
    assert response.status_code == 200
    ids = [a["id"] for a in response.json()]
    assert ids == [near_deadline_id, far_deadline_id]


def test_completed_date_independent_of_due_window(client: TestClient) -> None:
    action_id = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_start": "2027-07-01", "due_date_end": "2027-07-15"},
    ).json()["id"]

    response = client.patch(f"/api/actions/{action_id}", json={"completed_date": "2027-07-10"})
    assert response.status_code == 200
    body = response.json()
    assert body["completed_date"] == "2027-07-10"
    assert body["due_date_start"] == "2027-07-01"
    assert body["due_date_end"] == "2027-07-15"
    assert body["status"] == "completed"


def test_thin_action_type_is_accepted(client: TestClient) -> None:
    response = client.post("/api/actions", json={"action_type": "thin"})
    assert response.status_code == 201, response.text
    assert response.json()["action_type"] == "thin"
