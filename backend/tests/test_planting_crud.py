"""Planting CRUD, plus the bad-FK -> 409 contract (via commit_or_409, not a
raw 500) and the bed_id-change-requires-new-geometry 400 guard."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Bed") -> int:
    response = client.post("/api/beds", json={"name": name, "border_geometry": rectangle()})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_plant(db_session, slug: str = "test-basil") -> str:
    db_session.add(Plant(slug=slug, common_name="Basil", botanical_name="Ocimum basilicum"))
    db_session.commit()
    return slug


def test_create_planting_bad_plant_slug_returns_409(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": "no-such-plant",
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert response.status_code == 409


def test_create_planting_bad_bed_id_returns_409(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": 999999,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert response.status_code == 409


def test_planting_crud_round_trip(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    plant_slug = _create_plant(db_session)

    create_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    )
    assert create_response.status_code == 201, create_response.text
    planting_id = create_response.json()["id"]

    get_response = client.get(f"/api/plantings/{planting_id}")
    assert get_response.status_code == 200
    assert get_response.json()["plant_slug"] == plant_slug

    update_response = client.patch(
        f"/api/plantings/{planting_id}", json={"planted_date": "2026-04-01"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["planted_date"] == "2026-04-01"

    delete_response = client.delete(f"/api/plantings/{planting_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/plantings/{planting_id}").status_code == 404


def test_spacing_cm_persists_and_defaults_to_null(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    plant_slug = _create_plant(db_session)

    # No spacing_cm supplied -> falls back to None (client-side default to
    # the plant's own spread_cm).
    no_override_id = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "row",
            "geometry": rectangle(width=100, height=20),
        },
    ).json()["id"]
    assert client.get(f"/api/plantings/{no_override_id}").json()["spacing_cm"] is None

    # Explicit spacing_cm on create is persisted and returned.
    create_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "row",
            "geometry": rectangle(width=100, height=20),
            "spacing_cm": 15.5,
        },
    )
    assert create_response.status_code == 201, create_response.text
    planting_id = create_response.json()["id"]
    assert create_response.json()["spacing_cm"] == 15.5

    get_response = client.get(f"/api/plantings/{planting_id}")
    assert get_response.json()["spacing_cm"] == 15.5

    # PATCH updates it.
    update_response = client.patch(f"/api/plantings/{planting_id}", json={"spacing_cm": 22.0})
    assert update_response.status_code == 200
    assert update_response.json()["spacing_cm"] == 22.0


def test_changing_bed_id_without_new_geometry_is_rejected(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client, "Bed A")
    other_bed_id = _create_bed(client, "Bed B")
    plant_slug = _create_plant(db_session)

    planting_id = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
        },
    ).json()["id"]

    response = client.patch(f"/api/plantings/{planting_id}", json={"bed_id": other_bed_id})
    assert response.status_code == 400

    # Supplying new geometry alongside the bed_id change is accepted.
    response = client.patch(
        f"/api/plantings/{planting_id}",
        json={"bed_id": other_bed_id, "geometry": rectangle(width=15, height=15)},
    )
    assert response.status_code == 200
    assert response.json()["bed_id"] == other_bed_id
