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


def test_create_garden_plan_requires_season_name_and_year(client: TestClient) -> None:
    missing_year = client.post("/api/garden-plans", json={"season_name": "A"})
    assert missing_year.status_code == 422

    missing_season_name = client.post("/api/garden-plans", json={"year": 2027})
    assert missing_season_name.status_code == 422

    empty_body = client.post("/api/garden-plans", json={})
    assert empty_body.status_code == 422


def test_create_garden_plan_entry_bad_bed_id_returns_409(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]

    response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "bed_id": 999999, "desired_quantity": 1},
    )
    assert response.status_code == 409


def test_create_garden_plan_entry_for_missing_plan_404(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    response = client.post(
        "/api/garden-plans/999999/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    )
    assert response.status_code == 404


def test_list_garden_plan_entries_for_missing_plan_404(client: TestClient) -> None:
    assert client.get("/api/garden-plans/999999/entries").status_code == 404


def test_garden_plan_entry_desired_quantity_has_no_positivity_constraint(
    client: TestClient, db_session
) -> None:
    """No `ge=`/`gt=` constraint is declared on `desired_quantity` (plain
    `int`) - documents actual behavior (0 and negative values are currently
    accepted, not rejected) rather than assuming validation exists that
    isn't actually there."""
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]

    zero_response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 0},
    )
    assert zero_response.status_code == 201, zero_response.text
    assert zero_response.json()["desired_quantity"] == 0

    negative_response = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": -3},
    )
    assert negative_response.status_code == 201, negative_response.text
    assert negative_response.json()["desired_quantity"] == -3


def test_garden_plan_entry_desired_quantity_is_optional(client: TestClient, db_session) -> None:
    """#276: desired_quantity is nullable, same "not yet assigned" shape as
    bed_id - an entry can exist before a quantity is decided."""
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]

    create_response = client.post(
        f"/api/garden-plans/{plan_id}/entries", json={"plant_slug": plant_slug}
    )
    assert create_response.status_code == 201, create_response.text
    entry = create_response.json()
    assert entry["desired_quantity"] is None
    entry_id = entry["id"]

    quantity_response = client.patch(
        f"/api/garden-plans/{plan_id}/entries/{entry_id}", json={"desired_quantity": 6}
    )
    assert quantity_response.status_code == 200
    assert quantity_response.json()["desired_quantity"] == 6

    cleared_response = client.patch(
        f"/api/garden-plans/{plan_id}/entries/{entry_id}", json={"desired_quantity": None}
    )
    assert cleared_response.status_code == 200
    assert cleared_response.json()["desired_quantity"] is None


def test_update_garden_plan_entry_bad_plant_slug_returns_409(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    entry_id = client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    ).json()["id"]

    response = client.patch(
        f"/api/garden-plans/{plan_id}/entries/{entry_id}", json={"plant_slug": "no-such-plant"}
    )
    assert response.status_code == 409


def test_update_garden_plan_entry_ignores_garden_plan_id_reassignment(
    client: TestClient, db_session
) -> None:
    """`garden_plan_id` is deliberately popped out of the PATCH payload
    (per the route's own comment) - an entry can't be silently reparented
    to a different plan through this endpoint."""
    plant_slug = _create_plant(db_session)
    plan_a_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    plan_b_id = client.post("/api/garden-plans", json={"season_name": "B", "year": 2027}).json()["id"]
    entry_id = client.post(
        f"/api/garden-plans/{plan_a_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    ).json()["id"]

    response = client.patch(
        f"/api/garden-plans/{plan_a_id}/entries/{entry_id}",
        json={"garden_plan_id": plan_b_id, "desired_quantity": 9},
    )
    assert response.status_code == 200
    assert response.json()["garden_plan_id"] == plan_a_id  # unchanged, not reparented
    assert response.json()["desired_quantity"] == 9  # the rest of the patch still applied

    # Still only visible under plan A, not plan B.
    assert len(client.get(f"/api/garden-plans/{plan_a_id}/entries").json()) == 1
    assert len(client.get(f"/api/garden-plans/{plan_b_id}/entries").json()) == 0


def test_deleting_a_bed_referenced_by_a_garden_plan_entry_returns_409_not_500(
    client: TestClient, db_session
) -> None:
    """`garden_plan_entry.bed_id` has no ON DELETE behavior in the migration
    (plain FK) and bed deletion's own cascade logic (beds.py) only cleans up
    Planting/BedEquipment rows, not GardenPlanEntry - a bed still referenced
    by a plan entry should hit a real, clean 409 via commit_or_409, not an
    unhandled 500 from a raw FK-violation exception."""
    plant_slug = _create_plant(db_session)
    bed_id = client.post("/api/beds", json={"name": "Bed", "border_geometry": rectangle()}).json()["id"]
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "bed_id": bed_id, "desired_quantity": 1},
    )

    response = client.delete(f"/api/beds/{bed_id}")
    assert response.status_code == 409

    # Even the bed's own cascade=true delete doesn't know about
    # garden_plan_entry - same 409, not a crash.
    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 409


def test_deleting_a_plant_referenced_by_a_garden_plan_entry_returns_409_not_500(
    client: TestClient, db_session
) -> None:
    """KNOWN REAL BUG (found by this test, filed on #28 - see that issue's
    tester comment): this currently raises an unhandled 500
    (sqlalchemy.exc.IntegrityError propagating straight out of the request),
    not a clean 409.

    Root cause: `plants.py`'s `delete_plant` deletes the `Plant` row itself
    via a Core-style bulk statement (`session.exec(delete(PlantTable)...)`),
    which Postgres executes - and checks FK constraints for - immediately,
    not deferred to `session.commit()`. `commit_or_409` (app/api/deps.py)
    only wraps `session.commit()` in its try/except, so a constraint
    violation raised by that earlier `session.exec()` call entirely bypasses
    it. Contrast with `beds.py`'s `delete_bed`, which uses ORM-instance-style
    `session.delete(bed)` - that defers the actual SQL DELETE to
    flush/commit time, which happens *inside* `commit_or_409`'s try block,
    so the equivalent bed-deletion case (see
    `test_deleting_a_bed_referenced_by_a_garden_plan_entry_returns_409_not_500`
    above) correctly gets a 409. Nothing referenced `plant.slug` via a real,
    not-already-cleaned-up FK before #28 added `garden_plan_entry.plant_slug`
    - this crash path didn't exist until that migration landed.

    Left failing on purpose (not skipped/deleted) - fix direction is either
    switching `delete_plant` to `session.delete(plant)` (matching beds.py),
    or having it explicitly clean up `garden_plan_entry` rows the same way
    it already does for every other plant-referencing satellite table, or
    both."""
    plant_slug = _create_plant(db_session)
    plan_id = client.post("/api/garden-plans", json={"season_name": "A", "year": 2027}).json()["id"]
    client.post(
        f"/api/garden-plans/{plan_id}/entries",
        json={"plant_slug": plant_slug, "desired_quantity": 1},
    )

    response = client.delete(f"/api/plants/{plant_slug}")
    assert response.status_code == 409
