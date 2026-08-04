"""IrrigationPart CRUD (#37) - parts-catalog stock tracking (nozzles,
T-junctions, connectors, valves, hose segments) and its derived
"needs purchase" status. #254 redefined "needs purchase" in terms of placed
IrrigationPartInstance rows rather than IrrigationConnection references, and
moved diagram_x/diagram_y off this table onto IrrigationPartInstance - see
test_irrigation_part_instance_crud.py for that."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _make_instance(client: TestClient, part_id: int) -> dict:
    response = client.post("/api/irrigation-part-instances", json={"part_id": part_id})
    assert response.status_code == 201, response.text
    return response.json()


def test_irrigation_part_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena 13mm T-junction", "part_type": "t_junction", "quantity_on_hand": 6},
    )
    assert create_response.status_code == 201, create_response.text
    part = create_response.json()
    part_id = part["id"]
    assert part["name"] == "Gardena 13mm T-junction"
    assert part["quantity_on_hand"] == 6

    update_response = client.patch(f"/api/irrigation-parts/{part_id}", json={"quantity_on_hand": 4})
    assert update_response.status_code == 200
    assert update_response.json()["quantity_on_hand"] == 4

    list_response = client.get("/api/irrigation-parts")
    assert any(p["id"] == part_id for p in list_response.json())

    delete_response = client.delete(f"/api/irrigation-parts/{part_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/irrigation-parts/{part_id}").status_code == 404


def test_get_missing_irrigation_part_404(client: TestClient) -> None:
    assert client.get("/api/irrigation-parts/999999").status_code == 404


def test_patch_missing_irrigation_part_404(client: TestClient) -> None:
    assert client.patch("/api/irrigation-parts/999999", json={"quantity_on_hand": 1}).status_code == 404


def test_delete_missing_irrigation_part_404(client: TestClient) -> None:
    assert client.delete("/api/irrigation-parts/999999").status_code == 404


def test_create_irrigation_part_missing_required_fields_422(client: TestClient) -> None:
    response = client.post("/api/irrigation-parts", json={"name": "Nozzle only"})
    assert response.status_code == 422


def test_irrigation_part_detail_needs_purchase_false_when_stock_covers_instances(
    client: TestClient,
) -> None:
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena nozzle", "part_type": "nozzle", "quantity_on_hand": 2},
    ).json()
    _make_instance(client, nozzle["id"])

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["instance_count"] == 1
    assert detail["needs_purchase"] is False


def test_irrigation_part_detail_needs_purchase_true_when_stock_short(client: TestClient) -> None:
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena nozzle", "part_type": "nozzle", "quantity_on_hand": 0},
    ).json()
    _make_instance(client, nozzle["id"])

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["instance_count"] == 1
    assert detail["needs_purchase"] is True


def test_irrigation_part_detail_needs_purchase_false_with_no_instances(client: TestClient) -> None:
    part = client.post(
        "/api/irrigation-parts",
        json={"name": "Spare valve", "part_type": "valve", "quantity_on_hand": 0},
    ).json()
    detail = client.get(f"/api/irrigation-parts/{part['id']}").json()
    assert detail["instance_count"] == 0
    assert detail["needs_purchase"] is False


def test_deleting_irrigation_part_deletes_its_instances_and_connections(client: TestClient) -> None:
    nozzle = client.post(
        "/api/irrigation-parts", json={"name": "Nozzle", "part_type": "nozzle", "quantity_on_hand": 1}
    ).json()
    t_junction = client.post(
        "/api/irrigation-parts",
        json={"name": "T-junction", "part_type": "t_junction", "quantity_on_hand": 1},
    ).json()
    nozzle_instance = _make_instance(client, nozzle["id"])
    t_junction_instance = _make_instance(client, t_junction["id"])
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle_instance["id"], "to_instance_id": t_junction_instance["id"]},
    ).json()["id"]

    assert client.delete(f"/api/irrigation-parts/{nozzle['id']}").status_code == 204
    assert client.get(f"/api/irrigation-connections/{connection_id}").status_code == 404
    assert client.get(f"/api/irrigation-part-instances/{nozzle_instance['id']}").status_code == 404
    # The other endpoint of the connection is untouched.
    assert client.get(f"/api/irrigation-parts/{t_junction['id']}").status_code == 200
    assert client.get(f"/api/irrigation-part-instances/{t_junction_instance['id']}").status_code == 200


def test_deleting_irrigation_part_deletes_all_its_instances_connections_not_just_one(
    client: TestClient,
) -> None:
    """A part's instance can be the endpoint of several connections at once
    (e.g. a T-junction feeding two nozzles) - deleting the part must clean
    up every one of them, not just the first found."""
    hub = client.post(
        "/api/irrigation-parts", json={"name": "Hub T-junction", "part_type": "t_junction", "quantity_on_hand": 1}
    ).json()
    nozzle_a = client.post(
        "/api/irrigation-parts", json={"name": "Nozzle A", "part_type": "nozzle", "quantity_on_hand": 1}
    ).json()
    nozzle_b = client.post(
        "/api/irrigation-parts", json={"name": "Nozzle B", "part_type": "nozzle", "quantity_on_hand": 1}
    ).json()
    hub_instance = _make_instance(client, hub["id"])
    nozzle_a_instance = _make_instance(client, nozzle_a["id"])
    nozzle_b_instance = _make_instance(client, nozzle_b["id"])
    conn_a = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": hub_instance["id"], "to_instance_id": nozzle_a_instance["id"]},
    ).json()["id"]
    conn_b = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle_b_instance["id"], "to_instance_id": hub_instance["id"]},
    ).json()["id"]

    assert client.delete(f"/api/irrigation-parts/{hub['id']}").status_code == 204
    assert client.get(f"/api/irrigation-connections/{conn_a}").status_code == 404
    assert client.get(f"/api/irrigation-connections/{conn_b}").status_code == 404
    # Both leaf parts survive, only their connections to the deleted hub are gone.
    assert client.get(f"/api/irrigation-parts/{nozzle_a['id']}").status_code == 200
    assert client.get(f"/api/irrigation-parts/{nozzle_b['id']}").status_code == 200


def test_delete_irrigation_part_twice_is_404_the_second_time(client: TestClient) -> None:
    part_id = client.post(
        "/api/irrigation-parts", json={"name": "Once", "part_type": "connector", "quantity_on_hand": 1}
    ).json()["id"]
    assert client.delete(f"/api/irrigation-parts/{part_id}").status_code == 204
    assert client.delete(f"/api/irrigation-parts/{part_id}").status_code == 404


def test_create_irrigation_part_with_wrong_type_quantity_is_422(client: TestClient) -> None:
    response = client.post(
        "/api/irrigation-parts",
        json={"name": "Bad quantity", "part_type": "nozzle", "quantity_on_hand": "six"},
    )
    assert response.status_code == 422


def test_irrigation_part_detail_needs_purchase_false_at_exact_boundary(
    client: TestClient,
) -> None:
    """instance_count == quantity_on_hand is exactly enough stock, not
    short - needs_purchase should be False, not True, at that boundary."""
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Boundary nozzle", "part_type": "nozzle", "quantity_on_hand": 2},
    ).json()
    _make_instance(client, nozzle["id"])
    _make_instance(client, nozzle["id"])

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["instance_count"] == 2
    assert detail["quantity_on_hand"] == 2
    assert detail["needs_purchase"] is False


def test_irrigation_part_detail_needs_purchase_true_with_multiple_instances_short(
    client: TestClient,
) -> None:
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Short nozzle", "part_type": "nozzle", "quantity_on_hand": 1},
    ).json()
    for _ in range(3):
        _make_instance(client, nozzle["id"])

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["instance_count"] == 3
    assert detail["needs_purchase"] is True


def test_list_irrigation_parts_returns_multiple_parts(client: TestClient) -> None:
    names = {"Nozzle", "T-junction", "Connector", "Valve"}
    for name in names:
        assert (
            client.post(
                "/api/irrigation-parts",
                json={"name": name, "part_type": name.lower(), "quantity_on_hand": 1},
            ).status_code
            == 201
        )

    listed = client.get("/api/irrigation-parts").json()
    assert {p["name"] for p in listed} == names


def test_patch_irrigation_part_notes_only_leaves_other_fields_unchanged(
    client: TestClient,
) -> None:
    part = client.post(
        "/api/irrigation-parts",
        json={"name": "Nozzle", "part_type": "nozzle", "quantity_on_hand": 3, "notes": "original"},
    ).json()

    response = client.patch(f"/api/irrigation-parts/{part['id']}", json={"notes": "updated"})
    assert response.status_code == 200
    updated = response.json()
    assert updated["notes"] == "updated"
    assert updated["name"] == "Nozzle"
    assert updated["quantity_on_hand"] == 3


def test_irrigation_part_connector_size_field_round_trips(client: TestClient) -> None:
    """#212: connector_size_mm round-trips through create and GET, including
    via the derived IrrigationPartDetail response."""
    create_response = client.post(
        "/api/irrigation-parts",
        json={
            "name": "Gardena 13mm connector",
            "part_type": "connector",
            "quantity_on_hand": 3,
            "connector_size_mm": 13.0,
        },
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["connector_size_mm"] == pytest.approx(13.0)

    detail = client.get(f"/api/irrigation-parts/{created['id']}").json()
    assert detail["connector_size_mm"] == pytest.approx(13.0)


def test_irrigation_part_connector_size_defaults_to_null(client: TestClient) -> None:
    """#212: omitting the field on create is not a validation error - it
    defaults to null, same "not recorded yet" state as an existing row from
    before the migration that added it."""
    create_response = client.post(
        "/api/irrigation-parts",
        json={"name": "Plain nozzle", "part_type": "nozzle", "quantity_on_hand": 1},
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["connector_size_mm"] is None

    detail = client.get(f"/api/irrigation-parts/{created['id']}").json()
    assert detail["connector_size_mm"] is None


def test_confirm_zone_based_bed_equipment_completely_unaffected_by_irrigation_parts(
    client: TestClient,
) -> None:
    """#37 test criterion 5: IrrigationZone/zoned BedEquipment (#36) can
    still be created/queried normally alongside the new parts-catalog/
    connection model - the two are additive, not entangled."""
    zone_id = client.post("/api/irrigation-zones", json={"name": "Zone unaffected by #37"}).json()["id"]
    equipment_response = client.post(
        "/api/bed-equipment",
        json={"equipment_type": "drip_line", "water_delivery_lph": 2.0, "zone_id": zone_id},
    )
    assert equipment_response.status_code == 201, equipment_response.text

    zone_detail = client.get(f"/api/irrigation-zones/{zone_id}").json()
    assert zone_detail["total_water_delivery_lph"] == pytest.approx(2.0)

    # Also create an irrigation part alongside - the two models coexist
    # without cross-contamination.
    part = client.post(
        "/api/irrigation-parts",
        json={"name": "Coexisting nozzle", "part_type": "nozzle", "quantity_on_hand": 1},
    )
    assert part.status_code == 201
    assert client.get(f"/api/irrigation-zones/{zone_id}").json()["total_water_delivery_lph"] == pytest.approx(2.0)
