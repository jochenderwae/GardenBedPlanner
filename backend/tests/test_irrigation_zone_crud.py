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


def test_equipment_unassigned_to_any_zone_still_works_as_ordinary_bed_equipment(
    client: TestClient,
) -> None:
    """#36 test criterion 4, exercised directly (not just as a side effect of
    zone deletion): equipment created with no zone_id at all should behave
    exactly like BedEquipment did before zones existed - full CRUD, no
    zone-related side effects."""
    create_response = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "trellis", "water_delivery_lph": None},
    )
    assert create_response.status_code == 201, create_response.text
    equipment = create_response.json()
    assert equipment["zone_id"] is None

    update_response = client.patch(
        f"/api/bed-equipment/{equipment['id']}", json={"height_cm": 150}
    )
    assert update_response.status_code == 200
    assert update_response.json()["zone_id"] is None
    assert update_response.json()["height_cm"] == 150

    assert client.delete(f"/api/bed-equipment/{equipment['id']}").status_code == 204


def test_create_irrigation_zone_missing_required_name_422(client: TestClient) -> None:
    response = client.post("/api/irrigation-zones", json={"notes": "no name given"})
    assert response.status_code == 422


def test_patch_missing_irrigation_zone_404(client: TestClient) -> None:
    response = client.patch("/api/irrigation-zones/999999", json={"notes": "x"})
    assert response.status_code == 404


def test_delete_missing_irrigation_zone_404(client: TestClient) -> None:
    assert client.delete("/api/irrigation-zones/999999").status_code == 404


def test_delete_irrigation_zone_twice_is_404_the_second_time(client: TestClient) -> None:
    zone_id = client.post("/api/irrigation-zones", json={"name": "Once"}).json()["id"]
    assert client.delete(f"/api/irrigation-zones/{zone_id}").status_code == 204
    assert client.delete(f"/api/irrigation-zones/{zone_id}").status_code == 404


def test_create_bed_equipment_with_nonexistent_zone_id_is_409_not_500(
    client: TestClient,
) -> None:
    """FK violation on zone_id should surface as commit_or_409's 409, the
    same contract every other FK'd field in this app follows - not a raw
    500 with a stack trace."""
    response = client.post(
        "/api/bed-equipment", json={"equipment_type": "drip_line", "zone_id": 999999}
    )
    assert response.status_code == 409


def test_update_bed_equipment_to_nonexistent_zone_id_is_409_not_500(
    client: TestClient,
) -> None:
    equipment_id = client.post(
        "/api/bed-equipment", json={"equipment_type": "drip_line"}
    ).json()["id"]
    response = client.patch(
        f"/api/bed-equipment/{equipment_id}", json={"zone_id": 999999}
    )
    assert response.status_code == 409


def test_reassigning_equipment_between_zones_moves_its_water_delivery_total(
    client: TestClient,
) -> None:
    """Moving a piece of equipment from zone A to zone B via PATCH should be
    reflected in both zones' totals immediately - the total isn't cached or
    computed once at creation time."""
    zone_a = client.post("/api/irrigation-zones", json={"name": "Zone A"}).json()["id"]
    zone_b = client.post("/api/irrigation-zones", json={"name": "Zone B"}).json()["id"]

    equipment_id = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "drip_line", "water_delivery_lph": 4.0, "zone_id": zone_a},
    ).json()["id"]

    assert client.get(f"/api/irrigation-zones/{zone_a}").json()["total_water_delivery_lph"] == pytest.approx(4.0)
    assert client.get(f"/api/irrigation-zones/{zone_b}").json()["total_water_delivery_lph"] is None

    move_response = client.patch(
        f"/api/bed-equipment/{equipment_id}", json={"zone_id": zone_b}
    )
    assert move_response.status_code == 200

    assert client.get(f"/api/irrigation-zones/{zone_a}").json()["total_water_delivery_lph"] is None
    assert client.get(f"/api/irrigation-zones/{zone_b}").json()["total_water_delivery_lph"] == pytest.approx(4.0)


def test_unassigning_equipment_from_zone_via_patch_null_removes_it_from_total(
    client: TestClient,
) -> None:
    zone_id = client.post("/api/irrigation-zones", json={"name": "Zone"}).json()["id"]
    equipment_id = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "drip_line", "water_delivery_lph": 2.5, "zone_id": zone_id},
    ).json()["id"]
    assert client.get(f"/api/irrigation-zones/{zone_id}").json()["total_water_delivery_lph"] == pytest.approx(2.5)

    unassign_response = client.patch(
        f"/api/bed-equipment/{equipment_id}", json={"zone_id": None}
    )
    assert unassign_response.status_code == 200
    assert unassign_response.json()["zone_id"] is None

    detail = client.get(f"/api/irrigation-zones/{zone_id}").json()
    assert detail["total_water_delivery_lph"] is None
    assert detail["equipment"] == []


def test_list_irrigation_zones_returns_multiple_zones(client: TestClient) -> None:
    names = {"Front bed zone", "Berry row zone", "Greenhouse zone"}
    for name in names:
        assert client.post("/api/irrigation-zones", json={"name": name}).status_code == 201

    listed = client.get("/api/irrigation-zones").json()
    assert {z["name"] for z in listed} == names


def test_irrigation_zone_total_sums_more_than_two_rated_equipment_items(
    client: TestClient,
) -> None:
    """Boundary/robustness check beyond the existing two-item happy-path
    test: three rated items plus a fractional rate, to catch an
    off-by-one/float-summation regression that a two-item test might miss."""
    zone_id = client.post("/api/irrigation-zones", json={"name": "Big zone"}).json()["id"]
    rates = [0.5, 1.25, 3.0]
    for rate in rates:
        assert (
            client.post(
                "/api/bed-equipment",
                json={"equipment_type": "drip_line", "water_delivery_lph": rate, "zone_id": zone_id},
            ).status_code
            == 201
        )

    detail = client.get(f"/api/irrigation-zones/{zone_id}").json()
    assert detail["total_water_delivery_lph"] == pytest.approx(sum(rates))
    assert len(detail["equipment"]) == 3
