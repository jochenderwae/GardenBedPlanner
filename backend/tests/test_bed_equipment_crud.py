"""BedEquipment CRUD, including the nullable bed_id/geometry "unassigned
inventory" case (see app/models/bed_equipment.py's own docstring)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_bed_equipment_unassigned_inventory_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "trellis", "height_cm": 180},
    )
    assert create_response.status_code == 201, create_response.text
    equipment = create_response.json()
    assert equipment["bed_id"] is None
    assert equipment["geometry"] is None
    equipment_id = equipment["id"]

    get_response = client.get(f"/api/bed-equipment/{equipment_id}")
    assert get_response.status_code == 200
    assert get_response.json()["bed_id"] is None


def test_bed_equipment_crud_round_trip_assigned_to_a_bed(client: TestClient) -> None:
    bed_id = client.post(
        "/api/beds", json={"name": "Bed", "border_geometry": rectangle()}
    ).json()["id"]

    create_response = client.post(
        "/api/bed-equipment",
        json={
            "bed_id": bed_id,
            "equipment_type": "drip_line",
            "geometry": rectangle(width=10, height=200),
            "water_delivery_lph": 2.0,
        },
    )
    assert create_response.status_code == 201, create_response.text
    equipment_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/bed-equipment/{equipment_id}", json={"water_delivery_lph": 4.0}
    )
    assert update_response.status_code == 200
    assert update_response.json()["water_delivery_lph"] == 4.0

    list_response = client.get("/api/bed-equipment")
    assert any(e["id"] == equipment_id for e in list_response.json())

    delete_response = client.delete(f"/api/bed-equipment/{equipment_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/bed-equipment/{equipment_id}").status_code == 404


def test_get_missing_bed_equipment_404(client: TestClient) -> None:
    assert client.get("/api/bed-equipment/999999").status_code == 404
