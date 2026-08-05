"""GET /api/shopping-list (#255) - aggregates "needs purchase" shortfalls
across IrrigationPart (instance_count > quantity_on_hand, same derivation
as IrrigationPartDetail.needs_purchase) and BedEquipment (owned=False rows,
grouped by equipment_type) into a single list, per #255's own test
criteria."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _make_part(client: TestClient, name: str, part_type: str, quantity: int = 0) -> dict:
    response = client.post(
        "/api/irrigation-parts",
        json={"name": name, "part_type": part_type, "quantity_on_hand": quantity},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_irrigation_part_with_no_stock_can_still_be_placed_and_appears_on_shopping_list(
    client: TestClient,
) -> None:
    part = _make_part(client, "Scarce nozzle", "nozzle", quantity=0)
    instance_response = client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})
    assert instance_response.status_code == 201, instance_response.text

    shopping_list = client.get("/api/shopping-list").json()
    matching = [item for item in shopping_list if item["category"] == "irrigation_part" and item["source_id"] == part["id"]]
    assert len(matching) == 1
    assert matching[0]["quantity_needed"] == 1
    assert matching[0]["name"] == "Scarce nozzle"


def test_irrigation_part_shortfall_drops_off_once_stock_covers_it(client: TestClient) -> None:
    part = _make_part(client, "Valve", "valve", quantity=0)
    client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})

    before = client.get("/api/shopping-list").json()
    assert any(item["source_id"] == part["id"] for item in before if item["category"] == "irrigation_part")

    update_response = client.patch(f"/api/irrigation-parts/{part['id']}", json={"quantity_on_hand": 1})
    assert update_response.status_code == 200

    after = client.get("/api/shopping-list").json()
    assert not any(item["source_id"] == part["id"] for item in after if item["category"] == "irrigation_part")


def test_irrigation_part_fully_stocked_does_not_appear_on_shopping_list(client: TestClient) -> None:
    part = _make_part(client, "Well-stocked connector", "connector", quantity=5)
    client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})

    shopping_list = client.get("/api/shopping-list").json()
    assert not any(item["source_id"] == part["id"] for item in shopping_list if item["category"] == "irrigation_part")


def test_irrigation_part_type_part_number_surfaces_on_shopping_list_when_catalog_matches(
    client: TestClient,
) -> None:
    pack_response = client.post("/api/resource-packs", json={"name": "Gardena", "is_active": True})
    assert pack_response.status_code == 201, pack_response.text
    pack_id = pack_response.json()["id"]
    client.post(
        "/api/irrigation-part-types",
        json={
            "resource_pack_id": pack_id,
            "slug": "gardena_t_junction",
            "name": "Gardena T-junction 13mm",
            "connection_count": 3,
            "part_number": "8329-20",
        },
    )
    part = _make_part(client, "T-junction", "gardena_t_junction", quantity=0)
    client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})

    shopping_list = client.get("/api/shopping-list").json()
    matching = next(item for item in shopping_list if item["category"] == "irrigation_part" and item["source_id"] == part["id"])
    assert matching["part_number"] == "8329-20"


def test_bed_equipment_placed_without_being_owned_appears_on_shopping_list(client: TestClient) -> None:
    bed_id = client.post(
        "/api/beds",
        json={"name": "Bed", "border_geometry": rectangle()},
        params={"is_initial_state": "true"},
    ).json()["id"]

    create_response = client.post(
        "/api/bed-equipment",
        json={
            "bed_id": bed_id,
            "equipment_type": "trellis",
            "geometry": rectangle(width=10, height=200),
            "owned": False,
        },
        params={"is_initial_state": "true"},
    )
    assert create_response.status_code == 201, create_response.text
    assert create_response.json()["owned"] is False

    shopping_list = client.get("/api/shopping-list").json()
    matching = [item for item in shopping_list if item["category"] == "equipment" and item["type_key"] == "trellis"]
    assert len(matching) == 1
    assert matching[0]["quantity_needed"] == 1


def test_bed_equipment_shortfall_drops_off_once_marked_owned(client: TestClient) -> None:
    equipment_id = client.post(
        "/api/bed-equipment", json={"equipment_type": "stake", "owned": False}
    ).json()["id"]

    before = client.get("/api/shopping-list").json()
    assert any(item["category"] == "equipment" and item["type_key"] == "stake" for item in before)

    update_response = client.patch(f"/api/bed-equipment/{equipment_id}", json={"owned": True})
    assert update_response.status_code == 200
    assert update_response.json()["owned"] is True

    after = client.get("/api/shopping-list").json()
    assert not any(item["category"] == "equipment" and item["type_key"] == "stake" for item in after)


def test_bed_equipment_defaults_to_owned_and_does_not_appear_on_shopping_list(client: TestClient) -> None:
    client.post("/api/bed-equipment", json={"equipment_type": "cold_frame"})

    shopping_list = client.get("/api/shopping-list").json()
    assert not any(item["category"] == "equipment" and item["type_key"] == "cold_frame" for item in shopping_list)


def test_multiple_unowned_equipment_of_the_same_type_are_aggregated_into_one_line(client: TestClient) -> None:
    client.post("/api/bed-equipment", json={"equipment_type": "stake", "owned": False})
    client.post("/api/bed-equipment", json={"equipment_type": "stake", "owned": False})

    shopping_list = client.get("/api/shopping-list").json()
    matching = [item for item in shopping_list if item["category"] == "equipment" and item["type_key"] == "stake"]
    assert len(matching) == 1
    assert matching[0]["quantity_needed"] == 2


def test_equipment_type_catalog_name_surfaces_on_shopping_list_when_it_matches(client: TestClient) -> None:
    equipment_type_response = client.post(
        "/api/equipment-types",
        json={
            "slug": "raised_trellis",
            "name": "Raised Trellis Panel",
            "category": "bed_bound",
            "default_geometry": rectangle(width=10, height=180),
        },
    )
    assert equipment_type_response.status_code == 201, equipment_type_response.text
    client.post("/api/bed-equipment", json={"equipment_type": "raised_trellis", "owned": False})

    shopping_list = client.get("/api/shopping-list").json()
    matching = next(item for item in shopping_list if item["category"] == "equipment" and item["type_key"] == "raised_trellis")
    assert matching["name"] == "Raised Trellis Panel"


def test_shopping_list_combines_both_categories_in_one_response(client: TestClient) -> None:
    part = _make_part(client, "Combined-test nozzle", "nozzle", quantity=0)
    client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})
    client.post("/api/bed-equipment", json={"equipment_type": "combined_test_stake", "owned": False})

    shopping_list = client.get("/api/shopping-list").json()
    categories = {item["category"] for item in shopping_list}
    assert categories == {"irrigation_part", "equipment"}
