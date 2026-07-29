"""IrrigationConnection CRUD (#37) - the pipe-network edge list recording
which IrrigationPart connects to which."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _make_part(client: TestClient, name: str, part_type: str, quantity: int = 1) -> dict:
    response = client.post(
        "/api/irrigation-parts",
        json={"name": name, "part_type": part_type, "quantity_on_hand": quantity},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_irrigation_connection_crud_round_trip(client: TestClient) -> None:
    nozzle = _make_part(client, "Nozzle", "nozzle")
    t_junction = _make_part(client, "T-junction", "t_junction")

    create_response = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"], "notes": "Bed 1 run"},
    )
    assert create_response.status_code == 201, create_response.text
    connection = create_response.json()
    connection_id = connection["id"]
    assert connection["from_part_id"] == nozzle["id"]
    assert connection["to_part_id"] == t_junction["id"]

    update_response = client.patch(
        f"/api/irrigation-connections/{connection_id}", json={"notes": "Bed 2 run"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["notes"] == "Bed 2 run"

    list_response = client.get("/api/irrigation-connections")
    assert any(c["id"] == connection_id for c in list_response.json())

    delete_response = client.delete(f"/api/irrigation-connections/{connection_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/irrigation-connections/{connection_id}").status_code == 404


def test_get_missing_irrigation_connection_404(client: TestClient) -> None:
    assert client.get("/api/irrigation-connections/999999").status_code == 404


def test_delete_missing_irrigation_connection_404(client: TestClient) -> None:
    assert client.delete("/api/irrigation-connections/999999").status_code == 404


def test_create_connection_to_self_is_400(client: TestClient) -> None:
    part = _make_part(client, "Connector", "connector")
    response = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": part["id"], "to_part_id": part["id"]},
    )
    assert response.status_code == 400


def test_patch_connection_to_self_is_400(client: TestClient) -> None:
    nozzle = _make_part(client, "Nozzle", "nozzle")
    t_junction = _make_part(client, "T-junction", "t_junction")
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
    ).json()["id"]

    response = client.patch(
        f"/api/irrigation-connections/{connection_id}", json={"to_part_id": nozzle["id"]}
    )
    assert response.status_code == 400


def test_create_connection_with_nonexistent_part_is_409_not_500(client: TestClient) -> None:
    part = _make_part(client, "Nozzle", "nozzle")
    response = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": part["id"], "to_part_id": 999999},
    )
    assert response.status_code == 409


def test_list_connections_filtered_by_part_id(client: TestClient) -> None:
    nozzle = _make_part(client, "Nozzle", "nozzle")
    t_junction = _make_part(client, "T-junction", "t_junction")
    valve = _make_part(client, "Valve", "valve")

    conn_1 = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
    ).json()
    # Unrelated connection, shouldn't show up when filtering by nozzle.
    client.post(
        "/api/irrigation-connections",
        json={"from_part_id": t_junction["id"], "to_part_id": valve["id"]},
    )

    filtered = client.get(f"/api/irrigation-connections?part_id={nozzle['id']}").json()
    assert len(filtered) == 1
    assert filtered[0]["id"] == conn_1["id"]

    # T-junction is in both connections.
    filtered_t = client.get(f"/api/irrigation-connections?part_id={t_junction['id']}").json()
    assert len(filtered_t) == 2


def test_confirm_connection_both_ends_come_back_correctly(client: TestClient) -> None:
    """#37 test criterion 3: query a part and confirm its recorded
    connections (both ends) come back correctly."""
    nozzle = _make_part(client, "Nozzle", "nozzle")
    t_junction = _make_part(client, "T-junction", "t_junction")

    connection = client.post(
        "/api/irrigation-connections",
        json={"from_part_id": nozzle["id"], "to_part_id": t_junction["id"]},
    ).json()

    from_side = client.get(f"/api/irrigation-connections?part_id={nozzle['id']}").json()
    to_side = client.get(f"/api/irrigation-connections?part_id={t_junction['id']}").json()
    assert [c["id"] for c in from_side] == [connection["id"]]
    assert [c["id"] for c in to_side] == [connection["id"]]
