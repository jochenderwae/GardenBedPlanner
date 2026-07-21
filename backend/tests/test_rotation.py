"""Family-based rotation/succession warnings (see app/services/rotation.py,
app/api/routes/rotation.py) - GET /api/beds/{bed_id}/rotation-check."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Family, Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Bed") -> int:
    response = client.post("/api/beds", json={"name": name, "border_geometry": rectangle()})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_plant(db_session, slug: str, common_name: str, botanical_name: str, family_id: int | None) -> str:
    db_session.add(
        Plant(slug=slug, common_name=common_name, botanical_name=botanical_name, family_id=family_id)
    )
    db_session.commit()
    return slug


def _create_family(db_session, name: str) -> int:
    family = Family(name=name)
    db_session.add(family)
    db_session.commit()
    db_session.refresh(family)
    return family.id


def test_rotation_check_404_for_missing_bed(client: TestClient) -> None:
    response = client.get("/api/beds/999999/rotation-check", params={"plant_slug": "no-such-plant"})
    assert response.status_code == 404


def test_rotation_check_404_for_missing_plant(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.get(f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": "no-such-plant"})
    assert response.status_code == 404


def test_rotation_check_no_warning_when_bed_empty(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)

    response = client.get(f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": tomato})
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_warns_on_recent_same_family_planting(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    create_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )
    assert create_response.status_code == 201, create_response.text

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_warning"] is True
    assert body["family_name"] == "Solanaceae"
    assert body["conflicting_plant_slug"] == tomato
    assert body["conflicting_plant_common_name"] == "Tomato"


def test_rotation_check_no_warning_for_different_family(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    legume_family = _create_family(db_session, "Fabaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    bean = _create_plant(db_session, "test-bean", "Bean", "Phaseolus vulgaris", legume_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": bean, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_no_warning_when_outside_lookback_window(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2020-04-01",
            "removed_date": "2020-09-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_no_warning_for_same_species(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )

    # Same species again isn't a *family*-rotation warning (it's just "the
    # same crop was here"), and check_rotation deliberately excludes it.
    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": tomato, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False
