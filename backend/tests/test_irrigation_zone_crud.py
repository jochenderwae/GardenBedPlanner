"""IrrigationZone CRUD (#36) - grouping BedEquipment rows into a drip
irrigation zone and querying the zone's combined water delivery."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_irrigation_zone_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/irrigation-zones", json={"name": "Berry row zone", "notes": "Fed by valve 2"}
    )
    assert create_response.status_code == 201, create_response.text
    zone = create_response.json()
    zone_id = zone["id"]
    assert zone["name"] == "Berry row zone"

    update_response = client.patch(
        f"/api/irrigation-zones/{zone_id}", json={"notes": "Fed by valve 3"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["notes"] == "Fed by valve 3"

    list_response = client.get("/api/irrigation-zones")
    assert any(z["id"] == zone_id for z in list_response.json())

    delete_response = client.delete(f"/api/irrigation-zones/{zone_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/irrigation-zones/{zone_id}").status_code == 404


def test_get_missing_irrigation_zone_404(client: TestClient) -> None:
    assert client.get("/api/irrigation-zones/999999").status_code == 404


def test_irrigation_zone_detail_totals_water_delivery_of_member_equipment(
    client: TestClient,
) -> None:
    zone_id = client.post("/api/irrigation-zones", json={"name": "Planters zone"}).json()["id"]

    e1 = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "drip_line", "water_delivery_lph": 2.0, "zone_id": zone_id},
    ).json()
    e2 = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "drip_line", "water_delivery_lph": 1.5, "zone_id": zone_id},
    ).json()
    # A zone member with no known rate - shouldn't be treated as 0.
    client.post(
        "/api/bed-equipment",
        json={"equipment_type": "stake", "zone_id": zone_id},
    )
    # Equipment outside the zone shouldn't count toward its total.
    client.post("/api/bed-equipment", json={"equipment_type": "trellis"})

    detail_response = client.get(f"/api/irrigation-zones/{zone_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["total_water_delivery_lph"] == pytest.approx(3.5)
    equipment_ids = {e["id"] for e in detail["equipment"]}
    assert equipment_ids == {e1["id"], e2["id"]} | {
        e["id"] for e in detail["equipment"] if e["equipment_type"] == "stake"
    }
    assert len(detail["equipment"]) == 3


def test_irrigation_zone_detail_total_is_none_with_no_rated_equipment(
    client: TestClient,
) -> None:
    zone_id = client.post("/api/irrigation-zones", json={"name": "Empty zone"}).json()["id"]
    detail = client.get(f"/api/irrigation-zones/{zone_id}").json()
    assert detail["total_water_delivery_lph"] is None
    assert detail["equipment"] == []


def test_deleting_zone_unassigns_member_equipment_instead_of_deleting_it(
    client: TestClient,
) -> None:
    zone_id = client.post("/api/irrigation-zones", json={"name": "To delete"}).json()["id"]
    equipment_id = client.post(
        "/api/bed-equipment", json={"equipment_type": "drip_line", "zone_id": zone_id}
    ).json()["id"]

    assert client.delete(f"/api/irrigation-zones/{zone_id}").status_code == 204

    equipment = client.get(f"/api/bed-equipment/{equipment_id}").json()
    assert equipment["zone_id"] is None
