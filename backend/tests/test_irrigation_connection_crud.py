"""IrrigationConnection CRUD (#37) - the pipe-network edge list recording
which IrrigationPartInstance connects to which. #254 re-pointed this at
IrrigationPartInstance (a placed physical unit) rather than IrrigationPart
directly (a catalog/stock row) - see that migration's own docstring."""

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


def _make_instance(client: TestClient, part_id: int) -> dict:
    response = client.post("/api/irrigation-part-instances", json={"part_id": part_id})
    assert response.status_code == 201, response.text
    return response.json()


def test_irrigation_connection_crud_round_trip(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])

    create_response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"], "notes": "Bed 1 run"},
    )
    assert create_response.status_code == 201, create_response.text
    connection = create_response.json()
    connection_id = connection["id"]
    assert connection["from_instance_id"] == nozzle["id"]
    assert connection["to_instance_id"] == t_junction["id"]

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
    instance = _make_instance(client, _make_part(client, "Connector", "connector")["id"])
    response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance["id"], "to_instance_id": instance["id"]},
    )
    assert response.status_code == 400


def test_patch_connection_to_self_is_400(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    ).json()["id"]

    response = client.patch(
        f"/api/irrigation-connections/{connection_id}", json={"to_instance_id": nozzle["id"]}
    )
    assert response.status_code == 400


def test_create_connection_with_nonexistent_instance_is_409_not_500(client: TestClient) -> None:
    instance = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance["id"], "to_instance_id": 999999},
    )
    assert response.status_code == 409


def test_list_connections_filtered_by_instance_id(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    valve = _make_instance(client, _make_part(client, "Valve", "valve")["id"])

    conn_1 = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    ).json()
    # Unrelated connection, shouldn't show up when filtering by nozzle.
    client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": t_junction["id"], "to_instance_id": valve["id"]},
    )

    filtered = client.get(f"/api/irrigation-connections?instance_id={nozzle['id']}").json()
    assert len(filtered) == 1
    assert filtered[0]["id"] == conn_1["id"]

    # T-junction is in both connections.
    filtered_t = client.get(f"/api/irrigation-connections?instance_id={t_junction['id']}").json()
    assert len(filtered_t) == 2


def test_confirm_connection_both_ends_come_back_correctly(client: TestClient) -> None:
    """#37 test criterion 3: query an instance and confirm its recorded
    connections (both ends) come back correctly."""
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])

    connection = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    ).json()

    from_side = client.get(f"/api/irrigation-connections?instance_id={nozzle['id']}").json()
    to_side = client.get(f"/api/irrigation-connections?instance_id={t_junction['id']}").json()
    assert [c["id"] for c in from_side] == [connection["id"]]
    assert [c["id"] for c in to_side] == [connection["id"]]


def test_delete_irrigation_connection_twice_is_404_the_second_time(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    ).json()["id"]

    assert client.delete(f"/api/irrigation-connections/{connection_id}").status_code == 204
    assert client.delete(f"/api/irrigation-connections/{connection_id}").status_code == 404


def test_create_connection_missing_required_field_is_422(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    response = client.post("/api/irrigation-connections", json={"from_instance_id": nozzle["id"]})
    assert response.status_code == 422


def test_create_connection_with_both_instances_nonexistent_is_409_not_500(client: TestClient) -> None:
    response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": 999997, "to_instance_id": 999998},
    )
    assert response.status_code == 409


def test_create_connection_to_self_with_nonexistent_id_is_400_not_409(client: TestClient) -> None:
    """The self-connection check should run before the FK is ever hit -
    passing the same nonexistent id twice is still "connects to itself"
    first, not a 409 about a missing instance."""
    response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": 999999, "to_instance_id": 999999},
    )
    assert response.status_code == 400


def test_update_connection_to_nonexistent_instance_is_409_not_500(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    connection_id = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    ).json()["id"]

    response = client.patch(
        f"/api/irrigation-connections/{connection_id}", json={"to_instance_id": 999999}
    )
    assert response.status_code == 409
    # The connection itself is untouched by the failed update.
    unchanged = client.get(f"/api/irrigation-connections/{connection_id}").json()
    assert unchanged["to_instance_id"] == t_junction["id"]


def test_list_connections_filtered_by_instance_id_with_no_matches_returns_empty(
    client: TestClient,
) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    lonely_instance = _make_instance(client, _make_part(client, "Lonely valve", "valve")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    )

    filtered = client.get(f"/api/irrigation-connections?instance_id={lonely_instance['id']}").json()
    assert filtered == []


def test_connection_notes_default_to_empty_string_when_omitted(client: TestClient) -> None:
    nozzle = _make_instance(client, _make_part(client, "Nozzle", "nozzle")["id"])
    t_junction = _make_instance(client, _make_part(client, "T-junction", "t_junction")["id"])
    response = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": nozzle["id"], "to_instance_id": t_junction["id"]},
    )
    assert response.status_code == 201
    assert response.json()["notes"] == ""


def test_two_instances_of_the_same_part_connect_independently(client: TestClient) -> None:
    """#254's core scenario: several physical units of the same part type,
    each with its own independent connections - connecting instance A of a
    part to one neighbor and instance B of the *same part* to a different
    neighbor must not share or collide with each other's connection."""
    t_junction_part = _make_part(client, "T-junction", "t_junction", quantity=6)
    instance_a = _make_instance(client, t_junction_part["id"])
    instance_b = _make_instance(client, t_junction_part["id"])
    nozzle_a = _make_instance(client, _make_part(client, "Nozzle A", "nozzle")["id"])
    nozzle_b = _make_instance(client, _make_part(client, "Nozzle B", "nozzle")["id"])

    conn_a = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance_a["id"], "to_instance_id": nozzle_a["id"]},
    )
    conn_b = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance_b["id"], "to_instance_id": nozzle_b["id"]},
    )
    assert conn_a.status_code == 201, conn_a.text
    assert conn_b.status_code == 201, conn_b.text

    a_connections = client.get(f"/api/irrigation-connections?instance_id={instance_a['id']}").json()
    b_connections = client.get(f"/api/irrigation-connections?instance_id={instance_b['id']}").json()
    assert [c["id"] for c in a_connections] == [conn_a.json()["id"]]
    assert [c["id"] for c in b_connections] == [conn_b.json()["id"]]
