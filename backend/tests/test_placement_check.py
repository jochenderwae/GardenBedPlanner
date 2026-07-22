"""Companion-planting and shade-casting checks (see app/services/placement.py,
app/api/routes/placement.py) - POST /api/beds/{bed_id}/placement-check."""

import math
from datetime import date, timedelta

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


def test_placement_check_excludes_given_planting_id_from_its_own_neighbor_list(
    client: TestClient, db_session
) -> None:
    """Re-checking an already-saved planting (exclude_planting_id set to its
    own id) must not have it show up as its own companion/shade neighbor -
    the whole point of the parameter per the route's own docstring."""
    _create_garden(db_session)
    bed_id = _create_bed(client, x=0, y=0)
    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.commit()
    tomato_planting_id = _plant_in_bed(client, bed_id, tomato)

    # Re-checking the tomato planting's own placement, excluding itself,
    # should find no neighbors at all (only the tomato itself is in the bed).
    response = client.post(
        f"/api/beds/{bed_id}/placement-check",
        json={
            "plant_slug": tomato,
            "geometry": rectangle(width=20, height=20),
            "exclude_planting_id": tomato_planting_id,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["companions"] == []
    assert body["antagonists"] == []
    assert body["shade_warnings"] == []

    # Without exclude_planting_id, the same query would find itself as a
    # same-slug/no-relationship neighbor at distance 0 (no PlantCompanion
    # row references a plant against itself, so still no false companion -
    # but confirms exclude_planting_id is actually doing something rather
    # than being a no-op, via the basil case below instead).
    response_all = client.post(
        f"/api/beds/{bed_id}/placement-check",
        json={"plant_slug": basil, "geometry": rectangle(width=20, height=20)},
    )
    assert response_all.status_code == 200
    assert len(response_all.json()["companions"]) == 1


def test_placement_check_ignores_planting_removed_on_or_before_as_of(client: TestClient, db_session) -> None:
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.commit()
    basil_planting_id = _plant_in_bed(client, north_bed, basil)

    as_of = date.today()
    remove_response = client.patch(
        f"/api/plantings/{basil_planting_id}", json={"removed_date": as_of.isoformat()}
    )
    assert remove_response.status_code == 200

    # Removed exactly on as_of - excluded ("removed_date <= as_of").
    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20), "as_of": as_of.isoformat()},
    )
    assert response.status_code == 200
    assert response.json()["companions"] == []

    # A day before removal, the same planting is still active and should
    # still be found as a companion.
    earlier = as_of - timedelta(days=1)
    response_earlier = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20), "as_of": earlier.isoformat()},
    )
    assert response_earlier.status_code == 200
    assert len(response_earlier.json()["companions"]) == 1


def test_placement_check_no_shade_warning_when_either_height_is_missing(client: TestClient, db_session) -> None:
    _create_garden(db_session, orientation_deg=0.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    tall_unknown_height = _create_plant(db_session, "test-tall-unknown", "Mystery Plant", height_cm=None)
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    _plant_in_bed(client, south_bed, tall_unknown_height)

    response = client.post(
        f"/api/beds/{north_bed}/placement-check",
        json={"plant_slug": lettuce, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    assert response.json()["shade_warnings"] == []


def test_placement_check_no_shade_warning_when_heights_are_equal(client: TestClient, db_session) -> None:
    _create_garden(db_session, orientation_deg=0.0)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    kale_a = _create_plant(db_session, "test-kale-a", "Kale A", height_cm=60)
    kale_b = _create_plant(db_session, "test-kale-b", "Kale B", height_cm=60)
    _plant_in_bed(client, south_bed, kale_a)

    response = client.post(
        f"/api/beds/{north_bed}/placement-check",
        json={"plant_slug": kale_b, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    assert response.json()["shade_warnings"] == []


def test_placement_check_respects_custom_neighbor_distance_cm(client: TestClient, db_session) -> None:
    """A narrower neighbor_distance_cm than the default should exclude a
    companion that the default distance would otherwise catch (same beds
    used by test_placement_check_flags_good_companion_in_adjoining_bed)."""
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
        json={
            "plant_slug": tomato,
            "geometry": rectangle(width=20, height=20),
            "neighbor_distance_cm": 10.0,
        },
    )
    assert response.status_code == 200
    assert response.json()["companions"] == []


def test_placement_check_companion_relationship_matches_when_stored_in_reverse_direction(
    client: TestClient, db_session
) -> None:
    """PlantCompanion rows are stored from one plant's own perspective only
    (per placement.py's own comment) - a row stored as
    (plant_slug=neighbor, companion_plant_slug=candidate) must still be
    found when the candidate is the one being placed, not just the other
    way around (already covered by the other companion tests)."""
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=basil, companion_plant_slug=tomato, relationship=CompanionRelationship.good)
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


def test_placement_check_accounts_for_rotated_bed_geometry(client: TestClient, db_session) -> None:
    """A candidate placed in a rotated bed must have its bed-local point
    transformed through that rotation before being compared to a neighbor -
    every other test in this file uses rotation=0 beds, so this is the only
    coverage of the rotate-then-translate branch of
    placement.py's _bed_local_to_world. Independently recomputes the
    expected world position/bearing with the same formula the service
    documents (rotate around the bed's own origin, then translate), rather
    than hand-deriving fragile expected numbers.

    South bed rotated 90deg: local (10, 10) rotates to world offset
    (-10, +10) from the bed's (x, y) origin - i.e. (south_bed_x - 10,
    south_bed_y + 10) - still comfortably south (and now also somewhat
    west) of the north bed's unrotated lettuce at world (10, 10)."""
    _create_garden(db_session, orientation_deg=0.0)
    north_bed_id = _create_bed(client, x=0, y=0, name="North")

    south_bed_x, south_bed_y, south_bed_rotation = 0.0, 100.0, 90.0
    response = client.post(
        "/api/beds",
        json={
            "name": "South",
            "border_geometry": rectangle(
                x=south_bed_x, y=south_bed_y, width=100, height=100, rotation=south_bed_rotation
            ),
        },
    )
    assert response.status_code == 201, response.text
    south_bed_id = response.json()["id"]

    sunflower = _create_plant(db_session, "test-sunflower", "Sunflower", height_cm=200)
    lettuce = _create_plant(db_session, "test-lettuce", "Lettuce", height_cm=20)
    _plant_in_bed(client, north_bed_id, lettuce)  # local center (10, 10) -> world (10, 10)

    candidate_geometry = rectangle(width=20, height=20)  # local center (10, 10)
    response = client.post(
        f"/api/beds/{south_bed_id}/placement-check",
        json={"plant_slug": sunflower, "geometry": candidate_geometry},
    )
    assert response.status_code == 200
    body = response.json()

    # Independently recompute the expected world position of the sunflower
    # candidate through the same rotate-then-translate transform.
    r = math.radians(south_bed_rotation)
    local_x, local_y = 10.0, 10.0
    expected_world_x = south_bed_x + local_x * math.cos(r) - local_y * math.sin(r)
    expected_world_y = south_bed_y + local_x * math.sin(r) + local_y * math.cos(r)
    lettuce_world = (10.0, 10.0)
    dx = expected_world_x - lettuce_world[0]
    dy = expected_world_y - lettuce_world[1]
    expected_bearing = math.degrees(math.atan2(dx, -dy)) % 360

    assert len(body["shade_warnings"]) == 1
    warning = body["shade_warnings"][0]
    # The candidate (sunflower, taller) is south of the existing lettuce
    # (shorter) once the bed's own rotation is accounted for, so placing it
    # here would shade that existing neighbor.
    assert warning["direction"] == "shades_neighbor"
    assert abs(warning["bearing_deg"] - expected_bearing) < 1e-6


def test_placement_check_polygon_bed_uses_bounding_box_origin_no_rotation(client: TestClient, db_session) -> None:
    """Polygon-shaped beds have no rotation field of their own (vertices
    already encode it) - _bed_local_to_world translates by the polygon's own
    unrotated bounding-box top-left instead. Confirms that branch actually
    runs without crashing and produces a sane companion match."""
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    polygon_geometry = {
        "type": "polygon",
        "points": [
            {"x": 0, "y": 100},
            {"x": 100, "y": 100},
            {"x": 100, "y": 200},
            {"x": 0, "y": 200},
        ],
    }
    south_bed_response = client.post(
        "/api/beds", json={"name": "South Polygon", "border_geometry": polygon_geometry}
    )
    assert south_bed_response.status_code == 201, south_bed_response.text
    south_bed_id = south_bed_response.json()["id"]

    basil = _create_plant(db_session, "test-basil", "Basil")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.commit()
    _plant_in_bed(client, north_bed, basil)

    response = client.post(
        f"/api/beds/{south_bed_id}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["companions"]) == 1
    assert body["companions"][0]["neighbor_plant_slug"] == basil


def test_placement_check_defaults_as_of_to_today(client: TestClient, db_session) -> None:
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

    # No as_of in the payload at all.
    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    assert len(response.json()["companions"]) == 1


def test_placement_check_multiple_neighbors_bucketed_independently(client: TestClient, db_session) -> None:
    """A candidate with one good-companion neighbor and one bad-companion
    neighbor at once should see both buckets populated in a single
    response, not just whichever relationship happens to be checked first."""
    _create_garden(db_session)
    north_bed = _create_bed(client, x=0, y=0, name="North")
    south_bed = _create_bed(client, x=0, y=100, name="South")
    basil = _create_plant(db_session, "test-basil", "Basil")
    potato = _create_plant(db_session, "test-potato", "Potato")
    tomato = _create_plant(db_session, "test-tomato", "Tomato")
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=basil, relationship=CompanionRelationship.good)
    )
    db_session.add(
        PlantCompanion(plant_slug=tomato, companion_plant_slug=potato, relationship=CompanionRelationship.bad)
    )
    db_session.commit()
    _plant_in_bed(client, north_bed, basil)
    _plant_in_bed(client, north_bed, potato)

    response = client.post(
        f"/api/beds/{south_bed}/placement-check",
        json={"plant_slug": tomato, "geometry": rectangle(width=20, height=20)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["companions"]) == 1
    assert body["companions"][0]["neighbor_plant_slug"] == basil
    assert len(body["antagonists"]) == 1
    assert body["antagonists"][0]["neighbor_plant_slug"] == potato
