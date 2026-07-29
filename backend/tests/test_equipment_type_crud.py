"""EquipmentType CRUD (#207) - the real-world default-geometry/
bed-bound-vs-garden-bound reference lookup for BedEquipment.equipment_type,
seeded from data/equipment_types.json via
app/scripts/import_equipment_types.py (not exercised directly here - these
tests cover the API's own CRUD contract using hand-built rows, same as
every other reference-table test in this suite)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _trellis_payload() -> dict:
    return {
        "slug": "trellis",
        "name": "Trellis",
        "category": "bed_bound",
        "default_geometry": rectangle(width=120, height=5),
        "default_height_cm": 180,
    }


def test_equipment_type_crud_round_trip(client: TestClient) -> None:
    create_response = client.post("/api/equipment-types", json=_trellis_payload())
    assert create_response.status_code == 201, create_response.text
    equipment_type = create_response.json()
    equipment_type_id = equipment_type["id"]
    assert equipment_type["slug"] == "trellis"
    assert equipment_type["category"] == "bed_bound"
    assert equipment_type["default_geometry"]["width"] == 120
    assert equipment_type["default_height_cm"] == 180

    update_response = client.patch(
        f"/api/equipment-types/{equipment_type_id}", json={"default_height_cm": 200}
    )
    assert update_response.status_code == 200
    assert update_response.json()["default_height_cm"] == 200

    list_response = client.get("/api/equipment-types")
    assert any(e["id"] == equipment_type_id for e in list_response.json())

    delete_response = client.delete(f"/api/equipment-types/{equipment_type_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/equipment-types/{equipment_type_id}").status_code == 404


def test_get_missing_equipment_type_404(client: TestClient) -> None:
    assert client.get("/api/equipment-types/999999").status_code == 404


def test_create_equipment_type_missing_required_fields_422(client: TestClient) -> None:
    response = client.post("/api/equipment-types", json={"slug": "stake"})
    assert response.status_code == 422


def test_create_equipment_type_invalid_category_422(client: TestClient) -> None:
    payload = _trellis_payload()
    payload["category"] = "not_a_real_category"
    response = client.post("/api/equipment-types", json=payload)
    assert response.status_code == 422


def test_garden_bound_functional_category_accepted(client: TestClient) -> None:
    """#207: the garden_bound_functional category (rain barrel, compost bin)
    needs to exist even though no dedicated model is built for it here."""
    payload = {
        "slug": "rain_barrel",
        "name": "Rain Barrel",
        "category": "garden_bound_functional",
        "default_geometry": rectangle(width=61, height=61),
        "default_height_cm": 93,
    }
    response = client.post("/api/equipment-types", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["category"] == "garden_bound_functional"


def test_duplicate_slug_is_409_not_500(client: TestClient) -> None:
    assert client.post("/api/equipment-types", json=_trellis_payload()).status_code == 201
    response = client.post("/api/equipment-types", json=_trellis_payload())
    assert response.status_code == 409
