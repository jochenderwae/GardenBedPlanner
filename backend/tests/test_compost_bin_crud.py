"""CompostBin CRUD (see app/models/compost_bin.py,
app/api/routes/compost_bins.py) - compost-specific state (fill state,
last-turned date, estimated maturity) for a bed acting as a compost
bin, 1:1 with Bed."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Compost bin 1") -> int:
    return client.post("/api/beds", json={"name": name, "border_geometry": rectangle()}).json()["id"]


def test_get_missing_compost_bin_404(client: TestClient) -> None:
    assert client.get("/api/compost-bins/999999").status_code == 404


def test_create_compost_bin_bad_bed_id_returns_409(client: TestClient) -> None:
    response = client.post("/api/compost-bins", json={"bed_id": 999999})
    assert response.status_code == 409


def test_compost_bin_defaults_to_empty(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.post("/api/compost-bins", json={"bed_id": bed_id})
    assert response.status_code == 201, response.text
    entry = response.json()
    assert entry["fill_state"] == "empty"
    assert entry["last_turned_date"] is None
    assert entry["estimated_maturity_date"] is None


def test_compost_bin_crud_round_trip(client: TestClient) -> None:
    bed_id = _create_bed(client)

    create_response = client.post("/api/compost-bins", json={"bed_id": bed_id, "fill_state": "filling"})
    assert create_response.status_code == 201, create_response.text
    bin_id = create_response.json()["id"]

    turn_response = client.patch(
        f"/api/compost-bins/{bin_id}",
        json={
            "fill_state": "curing",
            "last_turned_date": "2027-06-01",
            "estimated_maturity_date": "2027-08-01",
        },
    )
    assert turn_response.status_code == 200, turn_response.text
    turned = turn_response.json()
    assert turned["fill_state"] == "curing"
    assert turned["last_turned_date"] == "2027-06-01"
    assert turned["estimated_maturity_date"] == "2027-08-01"

    get_response = client.get(f"/api/compost-bins/{bin_id}")
    assert get_response.status_code == 200
    assert get_response.json()["last_turned_date"] == "2027-06-01"

    delete_response = client.delete(f"/api/compost-bins/{bin_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/compost-bins/{bin_id}").status_code == 404


def test_compost_bin_enforces_one_per_bed(client: TestClient) -> None:
    bed_id = _create_bed(client)
    first = client.post("/api/compost-bins", json={"bed_id": bed_id})
    assert first.status_code == 201

    second = client.post("/api/compost-bins", json={"bed_id": bed_id})
    assert second.status_code == 409


def test_list_compost_bins_filters_by_bed(client: TestClient) -> None:
    bed_a = _create_bed(client, "Compost bin A")
    bed_b = _create_bed(client, "Compost bin B")

    bin_a = client.post("/api/compost-bins", json={"bed_id": bed_a}).json()["id"]
    client.post("/api/compost-bins", json={"bed_id": bed_b})

    response = client.get("/api/compost-bins", params={"bed_id": bed_a})
    assert response.status_code == 200
    ids = [b["id"] for b in response.json()]
    assert ids == [bin_a]


def test_regular_bed_has_no_compost_bin_by_default(client: TestClient) -> None:
    bed_id = _create_bed(client, "Regular planter")
    response = client.get("/api/compost-bins", params={"bed_id": bed_id})
    assert response.status_code == 200
    assert response.json() == []


def test_create_compost_bin_missing_bed_id_422(client: TestClient) -> None:
    response = client.post("/api/compost-bins", json={})
    assert response.status_code == 422


def test_create_compost_bin_bad_fill_state_422(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.post("/api/compost-bins", json={"bed_id": bed_id, "fill_state": "overflowing"})
    assert response.status_code == 422


def test_patch_missing_compost_bin_404(client: TestClient) -> None:
    response = client.patch("/api/compost-bins/999999", json={"fill_state": "full"})
    assert response.status_code == 404


def test_delete_missing_compost_bin_404(client: TestClient) -> None:
    assert client.delete("/api/compost-bins/999999").status_code == 404


def test_delete_compost_bin_twice_is_404_the_second_time(client: TestClient) -> None:
    bed_id = _create_bed(client)
    bin_id = client.post("/api/compost-bins", json={"bed_id": bed_id}).json()["id"]
    assert client.delete(f"/api/compost-bins/{bin_id}").status_code == 204
    assert client.delete(f"/api/compost-bins/{bin_id}").status_code == 404


def test_update_compost_bin_bad_bed_id_returns_409(client: TestClient) -> None:
    bed_id = _create_bed(client)
    bin_id = client.post("/api/compost-bins", json={"bed_id": bed_id}).json()["id"]

    response = client.patch(f"/api/compost-bins/{bin_id}", json={"bed_id": 999999})
    assert response.status_code == 409

    # Untouched by the failed update - still points at the original bed.
    assert client.get(f"/api/compost-bins/{bin_id}").json()["bed_id"] == bed_id


def test_update_compost_bin_to_another_beds_id_conflicts_with_existing_bin(client: TestClient) -> None:
    """Moving a CompostBin's bed_id to a bed that already has its own
    CompostBin should trip the same unique-bed_id constraint an outright
    create does (test_compost_bin_enforces_one_per_bed), not silently
    succeed and leave two bins pointed at fields that no longer make
    sense."""
    bed_a = _create_bed(client, "Compost bin A")
    bed_b = _create_bed(client, "Compost bin B")
    bin_a_id = client.post("/api/compost-bins", json={"bed_id": bed_a}).json()["id"]
    client.post("/api/compost-bins", json={"bed_id": bed_b})

    response = client.patch(f"/api/compost-bins/{bin_a_id}", json={"bed_id": bed_b})
    assert response.status_code == 409
