"""CompostFertilizationLog CRUD (see
app/models/compost_fertilization_log.py,
app/api/routes/compost_fertilization_logs.py) - compost/fertilization
events logged against a specific Bed."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Bed") -> int:
    return client.post("/api/beds", json={"name": name, "border_geometry": rectangle()}).json()["id"]


def test_get_missing_compost_fertilization_log_404(client: TestClient) -> None:
    assert client.get("/api/compost-fertilization-logs/999999").status_code == 404


def test_create_compost_fertilization_log_bad_bed_id_returns_409(client: TestClient) -> None:
    response = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": 999999, "log_date": "2027-04-01", "type": "compost"},
    )
    assert response.status_code == 409


def test_compost_fertilization_log_crud_round_trip(client: TestClient) -> None:
    bed_id = _create_bed(client)

    create_response = client.post(
        "/api/compost-fertilization-logs",
        json={
            "bed_id": bed_id,
            "log_date": "2027-04-01",
            "type": "compost",
            "product": "homemade compost",
            "amount": "2 wheelbarrows",
            "notes": "top-dressed before spring planting",
        },
    )
    assert create_response.status_code == 201, create_response.text
    entry = create_response.json()
    assert entry["type"] == "compost"
    assert entry["amount"] == "2 wheelbarrows"
    entry_id = entry["id"]

    get_response = client.get(f"/api/compost-fertilization-logs/{entry_id}")
    assert get_response.status_code == 200
    assert get_response.json()["product"] == "homemade compost"

    update_response = client.patch(
        f"/api/compost-fertilization-logs/{entry_id}",
        json={"amount": "3 wheelbarrows", "notes": "updated amount"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["amount"] == "3 wheelbarrows"
    assert update_response.json()["notes"] == "updated amount"

    delete_response = client.delete(f"/api/compost-fertilization-logs/{entry_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/compost-fertilization-logs/{entry_id}").status_code == 404


def test_list_compost_fertilization_logs_filters_by_bed_and_orders_by_date(client: TestClient) -> None:
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    entry_a_later = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_a, "log_date": "2027-05-01", "type": "fertilizer"},
    ).json()["id"]
    entry_a_earlier = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_a, "log_date": "2027-03-01", "type": "compost"},
    ).json()["id"]
    client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_b, "log_date": "2027-04-01", "type": "compost"},
    )

    response = client.get("/api/compost-fertilization-logs", params={"bed_id": bed_a})
    assert response.status_code == 200
    ids = [e["id"] for e in response.json()]
    assert ids == [entry_a_earlier, entry_a_later]


def test_list_compost_fertilization_logs_across_all_beds(client: TestClient) -> None:
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    entry_a = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_a, "log_date": "2027-04-05", "type": "compost"},
    ).json()["id"]
    entry_b = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_b, "log_date": "2027-04-10", "type": "fertilizer"},
    ).json()["id"]

    response = client.get(
        "/api/compost-fertilization-logs",
        params={"log_date_from": "2027-04-01", "log_date_to": "2027-04-30"},
    )
    assert response.status_code == 200
    ids = {e["id"] for e in response.json()}
    assert ids == {entry_a, entry_b}


def test_compost_fertilization_log_defaults_are_valid(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "fertilizer"},
    )
    assert response.status_code == 201, response.text
    entry = response.json()
    assert entry["product"] == ""
    assert entry["amount"] == ""
    assert entry["notes"] == ""


def test_create_compost_fertilization_log_missing_required_fields_422(client: TestClient) -> None:
    bed_id = _create_bed(client)
    # Missing log_date and type.
    response = client.post("/api/compost-fertilization-logs", json={"bed_id": bed_id})
    assert response.status_code == 422


def test_create_compost_fertilization_log_bad_type_422(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "manure"},
    )
    assert response.status_code == 422


def test_patch_missing_compost_fertilization_log_404(client: TestClient) -> None:
    response = client.patch("/api/compost-fertilization-logs/999999", json={"notes": "x"})
    assert response.status_code == 404


def test_delete_missing_compost_fertilization_log_404(client: TestClient) -> None:
    assert client.delete("/api/compost-fertilization-logs/999999").status_code == 404


def test_delete_compost_fertilization_log_twice_is_404_the_second_time(client: TestClient) -> None:
    bed_id = _create_bed(client)
    entry_id = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "compost"},
    ).json()["id"]
    assert client.delete(f"/api/compost-fertilization-logs/{entry_id}").status_code == 204
    assert client.delete(f"/api/compost-fertilization-logs/{entry_id}").status_code == 404


def test_update_compost_fertilization_log_bad_bed_id_returns_409(client: TestClient) -> None:
    bed_id = _create_bed(client)
    entry_id = client.post(
        "/api/compost-fertilization-logs",
        json={"bed_id": bed_id, "log_date": "2027-04-01", "type": "compost"},
    ).json()["id"]

    response = client.patch(f"/api/compost-fertilization-logs/{entry_id}", json={"bed_id": 999999})
    assert response.status_code == 409

    # Untouched by the failed update - still points at the original bed.
    assert client.get(f"/api/compost-fertilization-logs/{entry_id}").json()["bed_id"] == bed_id
