"""Confirms Bed.orientation (backlog #75) is genuinely gone from the API,
not just from the model source - the column drop migration was already
verified by the implementer against garden_test directly; this covers the
route-level contract."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_bed_response_never_includes_an_orientation_key(client: TestClient) -> None:
    response = client.post(
        "/api/beds", json={"name": "Test Bed", "border_geometry": rectangle()}
    )
    assert response.status_code == 201, response.text
    assert "orientation" not in response.json()

    bed_id = response.json()["id"]
    get_response = client.get(f"/api/beds/{bed_id}")
    assert "orientation" not in get_response.json()

    list_response = client.get("/api/beds")
    assert list_response.status_code == 200
    assert all("orientation" not in bed for bed in list_response.json())


def test_sending_an_orientation_field_is_silently_ignored_not_rejected_or_persisted(
    client: TestClient,
) -> None:
    """FastAPI/Pydantic drops unrecognized fields by default - a client
    still sending the old `orientation` field (e.g. stale frontend code, a
    saved API request) must not crash the request, and the value must not
    end up persisted anywhere checkable."""
    response = client.post(
        "/api/beds",
        json={"name": "Test Bed", "border_geometry": rectangle(), "orientation": "north-facing"},
    )
    assert response.status_code == 201, response.text
    assert "orientation" not in response.json()

    bed_id = response.json()["id"]
    patch_response = client.patch(f"/api/beds/{bed_id}", json={"orientation": "south-facing"})
    assert patch_response.status_code == 200
    assert "orientation" not in patch_response.json()
