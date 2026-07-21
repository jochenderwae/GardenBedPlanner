"""Companion-planting and shade-casting checks (see app/services/placement.py,
app/api/routes/placement.py) - POST /api/beds/{bed_id}/placement-check."""

import pytest
from fastapi.testclient import TestClient

from app.models.garden import Garden
from app.models.plant import CompanionRelationship, Plant, PlantCompanion
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_garden(db_session, orientation_deg: float = 0.0) -> None:
    db_session.add(Garden(border_geometry=rectangle(width=1000, height=1000), orientation_deg=orientation_deg))
    db_session.commit()


def _create_bed(client: TestClient, x: float, y: float, name: str = "Bed") -> int:
    response = client.post(
        "/api/beds",
        json={"name": name, "border_geometry": rectangle(x=x, y=y, width=100, height=100)},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_plant(db_session, slug: str, common_name: str, height_cm: float | None = None) -> str:
    db_session.add(Plant(slug=slug, common_name=common_name, botanical_name=f"{slug} botanica", height_cm=height_cm))
    db_session.commit()
    return slug


def _plant_in_bed(client: TestClient, bed_id: int, plant_slug: str) -> int:
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_placement_check_404_for_missing_bed(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    plant_slug = _create_plant(db_session, "test-tomato", "Tomato")
    response = client.post(
        "/api/beds/999999/placement-check",
        json={"plant_slug": plant_slug, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 404


def test_placement_check_404_for_missing_plant(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    bed_id = _create_bed(client, x=0, y=0)
    response = client.post(
        f"/api/beds/{bed_id}/placement-check",
        json={"plant_slug": "no-such-plant", "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 404


def test_placement_check_404_for_missing_garden(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, x=0, y=0)
    plant_slug = _create_plant(db_session, "test-tomato", "Tomato")
    response = client.post(
        f"/api/beds/{bed_id}/placement-check",
        json={"plant_slug": plant_slug, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 404


def test_placement_check_flags_good_companion_in_adjoining_bed(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.commit()
    _plant_in_bed(client, north_bed, basil)

    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["companions"]) == 1
    assert body["companions"][0]["neighbor_plant_slug"] == basil
    assert body["antagonists"] == []


def test_placement_check_flags_bad_companion_in_adjoining_bed(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    potato = _create_plant(db_session, "test-potato", "Potato")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=potato, relationship=CompanionRelationship.bad)
    )
    db_session.commit()
    _plant_in_bed(client, north_bed, potato)

    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["companions"] == []
    assert len(body["antagonists"]) == 1
    assert body["antagonists"][0]["neighbor_plant_slug"] == potato


def test_placement_check_no_relationship_when_too_far_apart(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    near_bed = _create_bed(client, x=0, y=0, name="Near")
    far_bed = _create_bed(client, x=0, y=1000, name="Far")
    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.commit()
    _plant_in_bed(client, near_bed, basil)

    response = client.post(
        f"/api/beds/{far_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["companions"] == []
    assert body["antagonists"] == []


def test_placement_check_warns_when_existing_southern_neighbor_is_taller(client: TestClient, db_session) -> None:
    """Canonical shade-risk case per root CLAUDE.md's domain note: a taller
    existing neighbor to the candidate's south shades the candidate."""
    _create_garden(db_session, orientation_deg=0.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    sunflower = _create_plant(db_session, "test-sunflower", "Sunflower", height_cm=200)
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    _plant_in_bed(client, south_bed, sunflower)

    response = client.post(
        f"/api/beds/{north_bed}/placement-check",
        json={"plant_slug": lettuce, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["shade_warnings"]) == 1
    warning = body["shade_warnings"][0]
    assert warning["neighbor_plant_slug"] == sunflower
    assert warning["direction"] == "shaded_by_neighbor"
    assert abs(warning["bearing_deg"] - 180.0) < 1e-6


def test_placement_check_warns_when_candidate_is_taller_and_south_of_neighbor(
    client: TestClient, db_session
) -> None:
    """Reverse case (the item's own "how to test" #3): placing a tall plant
    south of a shorter existing plant should also warn - the new placement
    would shade that existing neighbor."""
    _create_garden(db_session, orientation_deg=0.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    sunflower = _create_plant(db_session, "test-sunflower", "Sunflower", height_cm=200)
    _plant_in_bed(client, north_bed, lettuce)

    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": sunflower, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["shade_warnings"]) == 1
    warning = body["shade_warnings"][0]
    assert warning["neighbor_plant_slug"] == lettuce
    assert warning["direction"] == "shades_neighbor"


def test_placement_check_no_shade_warning_when_neighbor_to_the_north(client: TestClient, db_session) -> None:
    _create_garden(db_session, orientation_deg=0.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    sunflower = _create_plant(db_session, "test-sunflower", "Sunflower", height_cm=200)
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    _plant_in_bed(client, north_bed, sunflower)

    # Candidate (short lettuce) placed south of the tall sunflower - a
    # northern neighbor, however tall, isn't a shade risk (sun is broadly
    # to the south), and the candidate is shorter so it can't shade the
    # sunflower back either.
    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": lettuce, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    assert response.json()["shade_warnings"] == []


def test_placement_check_shade_warning_disappears_after_garden_reorientation(
    client: TestClient, db_session
) -> None:
    """Rotating the garden's compass orientation changes what "south"
    means in canvas coordinates - the shade check must re-evaluate against
    the new true-north direction, not a stale absolute canvas angle."""
    _create_garden(db_session, orientation_deg=90.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    sunflower = _create_plant(db_session, "test-sunflower", "Sunflower", height_cm=200)
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    _plant_in_bed(client, south_bed, sunflower)

    # With the garden rotated 90 degrees, the canvas-south neighbor is no
    # longer bearing ~180 from true north, so the warning that fired at
    # orientation_deg=0 (see the canonical test above) should not fire here.
    response = client.post(
        f"/api/beds/{north_bed}/placement-check",
        json={"plant_slug": lettuce, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    assert response.json()["shade_warnings"] == []
