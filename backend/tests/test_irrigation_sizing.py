"""Nozzle sizing / runtime calculation for drip irrigation (#140) - GET
/api/beds/{bed_id}/irrigation-sizing (see app/services/irrigation_sizing.py,
app/api/routes/irrigation_sizing.py)."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, width: float = 100, height: float = 200) -> int:
    # 100cm x 200cm = 2 m^2, a round number that keeps the expected math
    # simple across every test below.
    response = client.post(
        "/api/beds", json={"name": "Bed", "border_geometry": rectangle(width=width, height=height)}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_plant(db_session, slug: str, water_needs_mm_per_week: float | None) -> str:
    db_session.add(
        Plant(
            slug=slug,
            common_name=slug,
            botanical_name=slug,
            water_needs_mm_per_week=water_needs_mm_per_week,
        )
    )
    db_session.commit()
    return slug


def _plant_bed(client: TestClient, bed_id: int, plant_slug: str) -> None:
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
        },
    )
    assert response.status_code == 201, response.text


def test_irrigation_sizing_404_for_missing_bed(client: TestClient) -> None:
    assert client.get("/api/beds/999999/irrigation-sizing").status_code == 404


def test_irrigation_sizing_with_no_plantings_has_no_governing_planting(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.get(f"/api/beds/{bed_id}/irrigation-sizing")
    assert response.status_code == 200
    data = response.json()
    assert data["bed_area_m2"] == pytest.approx(2.0)
    assert data["governing_planting"] is None
    assert data["target_volume_l_per_week"] is None
    assert data["required_runtime_hours_per_week"] is None


def test_irrigation_sizing_target_volume_from_single_planting(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)

    response = client.get(f"/api/beds/{bed_id}/irrigation-sizing")
    assert response.status_code == 200
    data = response.json()
    # 25mm/week x 2m^2 = 50 L/week (1mm over 1m^2 = 1 liter).
    assert data["target_volume_l_per_week"] == pytest.approx(50.0)
    assert data["governing_planting"]["plant_slug"] == tomato
    assert data["governing_planting"]["water_needs_mm_per_week"] == pytest.approx(25.0)


def test_irrigation_sizing_governing_planting_is_the_thirstiest(client: TestClient, db_session) -> None:
    """2026-07-28 user decision on #140: the thirstiest active planting
    governs, not an average across the bed's plantings."""
    bed_id = _create_bed(client)
    thirsty = _create_plant(db_session, "test-thirsty", water_needs_mm_per_week=40)
    modest = _create_plant(db_session, "test-modest", water_needs_mm_per_week=10)
    _plant_bed(client, bed_id, modest)
    _plant_bed(client, bed_id, thirsty)

    response = client.get(f"/api/beds/{bed_id}/irrigation-sizing")
    data = response.json()
    assert data["governing_planting"]["plant_slug"] == thirsty
    assert data["target_volume_l_per_week"] == pytest.approx(80.0)  # 40 x 2m^2


def test_irrigation_sizing_ignores_removed_plantings(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    gone = _create_plant(db_session, "test-gone", water_needs_mm_per_week=999)
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": gone,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2025-04-01",
            "removed_date": "2025-09-01",
        },
    )
    assert response.status_code == 201, response.text

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["governing_planting"] is None


def test_irrigation_sizing_ignores_plantings_with_no_known_water_need(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    unknown = _create_plant(db_session, "test-unknown", water_needs_mm_per_week=None)
    _plant_bed(client, bed_id, unknown)

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["governing_planting"] is None
    assert data["target_volume_l_per_week"] is None


def test_irrigation_sizing_required_runtime_from_bed_equipment(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)
    assert (
        client.post(
            "/api/bed-equipment",
            json={"bed_id": bed_id, "equipment_type": "drip_line", "water_delivery_lph": 5.0},
            params={"is_initial_state": "true"},
        ).status_code
        == 201
    )

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["total_water_delivery_lph"] == pytest.approx(5.0)
    # target 50 L/week / 5 L/hour = 10 hours/week.
    assert data["required_runtime_hours_per_week"] == pytest.approx(10.0)


def test_irrigation_sizing_sums_multiple_nozzles_on_the_bed(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)
    for lph in (2.0, 3.0):
        assert (
            client.post(
                "/api/bed-equipment",
                json={"bed_id": bed_id, "equipment_type": "drip_line", "water_delivery_lph": lph},
                params={"is_initial_state": "true"},
            ).status_code
            == 201
        )

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["total_water_delivery_lph"] == pytest.approx(5.0)
    assert data["required_runtime_hours_per_week"] == pytest.approx(10.0)


def test_irrigation_sizing_ignores_equipment_with_no_water_delivery_rate(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)
    assert (
        client.post(
            "/api/bed-equipment",
            json={"bed_id": bed_id, "equipment_type": "stake"},
            params={"is_initial_state": "true"},
        ).status_code
        == 201
    )

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["total_water_delivery_lph"] is None
    assert data["required_runtime_hours_per_week"] is None


def test_irrigation_sizing_required_lph_for_desired_runtime(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)

    response = client.get(
        f"/api/beds/{bed_id}/irrigation-sizing",
        params={"desired_runtime_hours_per_week": 5},
    )
    data = response.json()
    # target 50 L/week / 5 hours = 10 L/hour needed.
    assert data["required_lph_for_desired_runtime"] == pytest.approx(10.0)


def test_irrigation_sizing_desired_runtime_of_zero_does_not_divide_by_zero(client: TestClient, db_session) -> None:
    """desired_runtime_hours_per_week has no Query-level gt=0 constraint -
    a caller passing 0 (a nonsensical "water for zero hours" request, but
    not rejected by validation) must get a clean null back, not a 500
    from a ZeroDivisionError."""
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)

    response = client.get(
        f"/api/beds/{bed_id}/irrigation-sizing",
        params={"desired_runtime_hours_per_week": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["required_lph_for_desired_runtime"] is None


def test_irrigation_sizing_equipment_with_an_explicit_zero_rate_does_not_divide_by_zero(
    client: TestClient, db_session
) -> None:
    """A nozzle explicitly recorded at water_delivery_lph=0 (distinct from
    no rate set at all, which the query itself filters out) still sums to
    a real, non-null 0.0 total - required_runtime_hours_per_week must stay
    null rather than raising, since dividing by that 0.0 total would
    otherwise crash."""
    bed_id = _create_bed(client)
    tomato = _create_plant(db_session, "test-tomato", water_needs_mm_per_week=25)
    _plant_bed(client, bed_id, tomato)
    assert (
        client.post(
            "/api/bed-equipment",
            json={"bed_id": bed_id, "equipment_type": "drip_line", "water_delivery_lph": 0},
            params={"is_initial_state": "true"},
        ).status_code
        == 201
    )

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["total_water_delivery_lph"] == pytest.approx(0.0)
    assert data["required_runtime_hours_per_week"] is None


def test_irrigation_sizing_polygon_bed_area_uses_shoelace_formula(client: TestClient) -> None:
    # A right triangle, legs 100cm and 200cm: area = 0.5 * 100 * 200 =
    # 10000 cm^2 = 1 m^2.
    triangle = {
        "type": "polygon",
        "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 0, "y": 200}],
    }
    response = client.post("/api/beds", json={"name": "Triangle bed", "border_geometry": triangle})
    assert response.status_code == 201, response.text
    bed_id = response.json()["id"]

    data = client.get(f"/api/beds/{bed_id}/irrigation-sizing").json()
    assert data["bed_area_m2"] == pytest.approx(1.0)
