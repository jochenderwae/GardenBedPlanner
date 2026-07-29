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

    # cascade=true: an ordinary bed create auto-generates a prepare_bed
    # task against it (#192) - cascade cleans that up too, see
    # test_cascade_delete_actually_removes_dependent_plantings_and_equipment.
    delete_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
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


def test_delete_bed_without_cascade_conflicts_when_only_dependent_is_an_action(client: TestClient) -> None:
    """#210: an ordinary (non-backfill) bed create auto-generates a
    prepare_bed Action against it (#192) - confirms that alone is enough to
    409 a non-cascade delete (not just a Planting/BedEquipment dependent,
    which test_delete_bed_without_cascade_conflicts_when_referenced already
    covers), and that cascade=true still cleans it up."""
    bed_id = client.post(
        "/api/beds", json={"name": "Bed with auto-generated task", "border_geometry": rectangle()}
    ).json()["id"]

    actions = client.get("/api/actions").json()
    assert any(a["bed_id"] == bed_id and a["action_type"] == "prepare_bed" for a in actions)

    conflict_response = client.delete(f"/api/beds/{bed_id}")
    assert conflict_response.status_code == 409

    # Untouched, ready for a retry - not half-deleted.
    assert client.get(f"/api/beds/{bed_id}").status_code == 200
    assert any(a["bed_id"] == bed_id for a in client.get("/api/actions").json())

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204
    assert client.get(f"/api/beds/{bed_id}").status_code == 404
    assert [a for a in client.get("/api/actions").json() if a["bed_id"] == bed_id] == []


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


def test_cascade_delete_bed_with_compost_fertilization_log_should_succeed(client: TestClient) -> None:
    bed_id = client.post(
        "/api/beds", json={"name": "Bed With Compost Log", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]
    log_response = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "compost"},
    )
    assert log_response.status_code == 201, log_response.text
    log_id = log_response.json()["id"]

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204, cascade_response.text
    assert client.get(f"/api/compost-fertilization-logs/{log_id}").status_code == 404


@pytest.mark.xfail(
    reason="Bug found while testing #38 (same area, a different dependent table): delete_bed's "
    "cascade=true path deletes a bed's Plantings but never cleans up HarvestLog rows that "
    "reference one of those plantings via planting_id - unlike the CompostFertilizationLog gap "
    "just above (a clean 409), this one crashes with a raw 500. The FK violation fires during "
    "an autoflush triggered by a later SELECT inside the cascade block (delete_bed's own "
    "session.exec(select(BedEquipment)...) call), not at the final explicit session.commit() "
    "commit_or_409 wraps - so commit_or_409's try/except never even gets a chance to catch it. "
    "Same class of bug as #215 (a cascade-delete FK violation bypassing commit_or_409 due to "
    "autoflush timing), different trigger. Reported as a new issue rather than folded into #38 "
    "or fixed here. Remove this xfail once fixed.",
    strict=True,
)
def test_cascade_delete_bed_with_a_plantings_harvest_log_should_not_500(client: TestClient, db_session) -> None:
    from app.models.plant import Plant

    bed_id = client.post(
        "/api/beds", json={"name": "Bed With Harvested Planting", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]
    db_session.add(Plant(slug="test-harvest-cascade", common_name="Test", botanical_name="Testus e2eus"))
    db_session.commit()
    planting_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": "test-harvest-cascade",
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert planting_response.status_code == 201, planting_response.text
    planting_id = planting_response.json()["id"]
    harvest_log_response = client.post(
        "/api/harvest-logs", json={"planting_id": planting_id, "harvest_date": "2027-08-01"}
    )
    assert harvest_log_response.status_code == 201, harvest_log_response.text

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    # The bar here is deliberately just "not a raw 500" - either a clean
    # cascade (204, HarvestLog cleaned up too) or a clean 409 (blocked,
    # like CompostFertilizationLog above) would both be acceptable fixes;
    # a 500 is the one outcome that's definitely wrong.
    assert cascade_response.status_code in (204, 409), cascade_response.text


def test_cascade_delete_bed_with_compost_bin_should_succeed(client: TestClient) -> None:
    bed_id = client.post(
        "/api/beds", json={"name": "Compost Bin Bed", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]
    bin_response = client.post("/api/compost-bins", json={"bed_id": bed_id})
    assert bin_response.status_code == 201, bin_response.text
    bin_id = bin_response.json()["id"]

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204, cascade_response.text
    assert client.get(f"/api/compost-bins/{bin_id}").status_code == 404


def test_cascade_delete_bed_with_both_compost_log_and_compost_bin_should_succeed(client: TestClient) -> None:
    """#38 and #39's cascade fixes were verified independently against the
    tester's own xfail regressions - this confirms they also work together,
    a bed that is both a compost bin *and* has logged fertilization/compost
    history against it (a realistic combination: a compost bin can itself
    receive an activator/fertilizer application logged the same way as any
    other bed's), deleted with cascade=true in one call."""
    bed_id = client.post(
        "/api/beds", json={"name": "Compost Bin With History", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]

    log_response = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "fertilizer"},
    )
    assert log_response.status_code == 201, log_response.text
    log_id = log_response.json()["id"]

    bin_response = client.post("/api/compost-bins", json={"bed_id": bed_id})
    assert bin_response.status_code == 201, bin_response.text
    bin_id = bin_response.json()["id"]

    cascade_response = client.delete(f"/api/beds/{bed_id}", params={"cascade": "true"})
    assert cascade_response.status_code == 204, cascade_response.text
    assert client.get(f"/api/compost-fertilization-logs/{log_id}").status_code == 404
    assert client.get(f"/api/compost-bins/{bin_id}").status_code == 404
    assert client.get(f"/api/beds/{bed_id}").status_code == 404


def test_delete_bed_with_no_dependents_works_the_same_with_or_without_cascade(client: TestClient) -> None:
    # is_initial_state=true: a plain (non-backfill) create would auto-
    # generate a prepare_bed task against the bed (#192), which is exactly
    # the kind of dependent this test is deliberately trying to avoid.
    without_cascade_id = client.post(
        "/api/beds",
        json={"name": "Empty Bed A", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]
    assert client.delete(f"/api/beds/{without_cascade_id}").status_code == 204
    assert client.get(f"/api/beds/{without_cascade_id}").status_code == 404

    with_cascade_id = client.post(
        "/api/beds",
        json={"name": "Empty Bed B", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]
    assert client.delete(f"/api/beds/{with_cascade_id}", params={"cascade": "true"}).status_code == 204
    assert client.get(f"/api/beds/{with_cascade_id}").status_code == 404
