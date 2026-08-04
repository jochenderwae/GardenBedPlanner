"""IrrigationPartInstance CRUD (#254) - a single physically-placed unit of
an IrrigationPart stock row, with its own diagram position and independent
connections. Covers #254's own test criteria: placing multiple instances of
the same part, each connecting independently; flagging (not blocking) more
instances than quantity_on_hand; deleting one instance only removing its
own connections."""

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


def test_irrigation_part_instance_crud_round_trip(client: TestClient) -> None:
    part = _make_part(client, "Gardena 13mm T-junction", "t_junction", quantity=6)

    create_response = client.post(
        "/api/irrigation-part-instances",
        json={"part_id": part["id"], "diagram_x": 10.0, "diagram_y": 20.0},
    )
    assert create_response.status_code == 201, create_response.text
    instance = create_response.json()
    instance_id = instance["id"]
    assert instance["part_id"] == part["id"]
    assert instance["diagram_x"] == pytest.approx(10.0)
    assert instance["diagram_y"] == pytest.approx(20.0)

    update_response = client.patch(
        f"/api/irrigation-part-instances/{instance_id}", json={"diagram_x": 30.0, "diagram_y": 40.0}
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["diagram_x"] == pytest.approx(30.0)
    assert updated["diagram_y"] == pytest.approx(40.0)

    list_response = client.get("/api/irrigation-part-instances")
    assert any(i["id"] == instance_id for i in list_response.json())

    delete_response = client.delete(f"/api/irrigation-part-instances/{instance_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/irrigation-part-instances/{instance_id}").status_code == 404


def test_create_irrigation_part_instance_diagram_position_defaults_to_null(client: TestClient) -> None:
    part = _make_part(client, "Plain nozzle", "nozzle")
    create_response = client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["diagram_x"] is None
    assert created["diagram_y"] is None


def test_get_missing_irrigation_part_instance_404(client: TestClient) -> None:
    assert client.get("/api/irrigation-part-instances/999999").status_code == 404


def test_patch_missing_irrigation_part_instance_404(client: TestClient) -> None:
    assert client.patch("/api/irrigation-part-instances/999999", json={"diagram_x": 1.0}).status_code == 404


def test_delete_missing_irrigation_part_instance_404(client: TestClient) -> None:
    assert client.delete("/api/irrigation-part-instances/999999").status_code == 404


def test_create_irrigation_part_instance_with_nonexistent_part_is_409_not_500(client: TestClient) -> None:
    response = client.post("/api/irrigation-part-instances", json={"part_id": 999999})
    assert response.status_code == 409


def test_list_irrigation_part_instances_filtered_by_part_id(client: TestClient) -> None:
    part_a = _make_part(client, "T-junction A", "t_junction", quantity=3)
    part_b = _make_part(client, "T-junction B", "t_junction", quantity=3)
    inst_a1 = client.post("/api/irrigation-part-instances", json={"part_id": part_a["id"]}).json()
    inst_a2 = client.post("/api/irrigation-part-instances", json={"part_id": part_a["id"]}).json()
    client.post("/api/irrigation-part-instances", json={"part_id": part_b["id"]})

    filtered = client.get(f"/api/irrigation-part-instances?part_id={part_a['id']}").json()
    assert {i["id"] for i in filtered} == {inst_a1["id"], inst_a2["id"]}


def test_multiple_instances_of_the_same_part_can_be_placed_independently(client: TestClient) -> None:
    """#254 test criterion 1: a part owned in quantity > 1 can have several
    independent diagram-placed instances, not just one."""
    part = _make_part(client, "Gardena 13mm T-junction", "t_junction", quantity=6)
    positions = [(10.0, 10.0), (50.0, 10.0), (90.0, 10.0)]
    created_ids = set()
    for x, y in positions:
        response = client.post(
            "/api/irrigation-part-instances", json={"part_id": part["id"], "diagram_x": x, "diagram_y": y}
        )
        assert response.status_code == 201, response.text
        created_ids.add(response.json()["id"])

    assert len(created_ids) == 3
    listed = client.get(f"/api/irrigation-part-instances?part_id={part['id']}").json()
    assert {i["id"] for i in listed} == created_ids
    assert sorted((i["diagram_x"], i["diagram_y"]) for i in listed) == sorted(positions)


def test_needs_purchase_flags_but_does_not_block_placing_more_instances_than_stock(
    client: TestClient,
) -> None:
    """#254 test criterion 3: placing more instances than quantity_on_hand
    is allowed (not blocked), but clearly flagged via IrrigationPartDetail's
    needs_purchase - same "derived, not enforced" precedent as #37/#209's
    part-level needs_purchase."""
    part = _make_part(client, "Scarce valve", "valve", quantity=1)
    for _ in range(3):
        response = client.post("/api/irrigation-part-instances", json={"part_id": part["id"]})
        assert response.status_code == 201, response.text

    detail = client.get(f"/api/irrigation-parts/{part['id']}").json()
    assert detail["instance_count"] == 3
    assert detail["quantity_on_hand"] == 1
    assert detail["needs_purchase"] is True


def test_deleting_one_instance_only_removes_its_own_connections(client: TestClient) -> None:
    """#254 test criterion 4: deleting one instance must not affect a
    sibling instance of the same part type, nor that sibling's own
    connections."""
    t_junction_part = _make_part(client, "T-junction", "t_junction", quantity=6)
    instance_a = client.post("/api/irrigation-part-instances", json={"part_id": t_junction_part["id"]}).json()
    instance_b = client.post("/api/irrigation-part-instances", json={"part_id": t_junction_part["id"]}).json()
    nozzle_a = client.post(
        "/api/irrigation-part-instances",
        json={"part_id": _make_part(client, "Nozzle A", "nozzle")["id"]},
    ).json()
    nozzle_b = client.post(
        "/api/irrigation-part-instances",
        json={"part_id": _make_part(client, "Nozzle B", "nozzle")["id"]},
    ).json()

    conn_a = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance_a["id"], "to_instance_id": nozzle_a["id"]},
    ).json()
    conn_b = client.post(
        "/api/irrigation-connections",
        json={"from_instance_id": instance_b["id"], "to_instance_id": nozzle_b["id"]},
    ).json()

    assert client.delete(f"/api/irrigation-part-instances/{instance_a['id']}").status_code == 204
    # instance_a's own connection is gone.
    assert client.get(f"/api/irrigation-connections/{conn_a['id']}").status_code == 404
    # instance_b (same part type) and its own connection survive untouched.
    assert client.get(f"/api/irrigation-part-instances/{instance_b['id']}").status_code == 200
    assert client.get(f"/api/irrigation-connections/{conn_b['id']}").status_code == 200
    # The part itself (the stock row both instances belong to) survives.
    assert client.get(f"/api/irrigation-parts/{t_junction_part['id']}").status_code == 200


def test_delete_irrigation_part_instance_twice_is_404_the_second_time(client: TestClient) -> None:
    part = _make_part(client, "Once", "connector")
    instance_id = client.post("/api/irrigation-part-instances", json={"part_id": part["id"]}).json()["id"]
    assert client.delete(f"/api/irrigation-part-instances/{instance_id}").status_code == 204
    assert client.delete(f"/api/irrigation-part-instances/{instance_id}").status_code == 404
