"""IrrigationPart CRUD (#37) - parts-catalog stock tracking (nozzles,
T-junctions, connectors, valves, hose segments) and its derived
"needs purchase" status."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


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


def test_irrigation_part_detail_needs_purchase_false_when_stock_covers_connections(
    client: TestClient,
) -> None:
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena nozzle", "part_type": "nozzle", "quantity_on_hand": 2},
    ).json()
    t_junction = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena T-junction", "part_type": "t_junction", "quantity_on_hand": 2},
    ).json()

    connect_response = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
    )
    assert connect_response.status_code == 201, connect_response.text

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["connections_needed"] == 1
    assert detail["needs_purchase"] is False


def test_irrigation_part_detail_needs_purchase_true_when_stock_short(client: TestClient) -> None:
    nozzle = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena nozzle", "part_type": "nozzle", "quantity_on_hand": 0},
    ).json()
    t_junction = client.post(
        "/api/irrigation-parts",
        json={"name": "Gardena T-junction", "part_type": "t_junction", "quantity_on_hand": 2},
    ).json()

    assert (
        client.post(
            "/api/irrigation-connections",
            json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
        ).status_code
        == 201
    )

    detail = client.get(f"/api/irrigation-parts/{nozzle['id']}").json()
    assert detail["connections_needed"] == 1
    assert detail["needs_purchase"] is True


def test_irrigation_part_detail_needs_purchase_false_with_no_connections(client: TestClient) -> None:
    part = client.post(
        "/api/irrigation-parts",
        json={"name": "Spare valve", "part_type": "valve", "quantity_on_hand": 0},
    ).json()
    detail = client.get(f"/api/irrigation-parts/{part['id']}").json()
    assert detail["connections_needed"] == 0
    assert detail["needs_purchase"] is False


def test_deleting_irrigation_part_deletes_its_connections(client: TestClient) -> None:
    nozzle = client.post(
        "/api/irrigation-parts", json={"name": "Nozzle", "part_type": "nozzle", "quantity_on_hand": 1}
    ).json()
    t_junction = client.post(
        "/api/irrigation-parts",
        json={"name": "T-junction", "part_type": "t_junction", "quantity_on_hand": 1},
    ).json()
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
    ).json()["id"]

    assert client.delete(f"/api/irrigation-parts/{nozzle['id']}").status_code == 204
    assert client.get(f"/api/irrigation-connections/{connection_id}").status_code == 404
    # The other endpoint of the connection is untouched.
    assert client.get(f"/api/irrigation-parts/{t_junction['id']}").status_code == 200
