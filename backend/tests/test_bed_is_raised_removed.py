"""Confirms Bed.is_raised (backlog #77) is genuinely gone from the API,
not just from the model source - the column drop migration was already
verified by the implementer against garden_test directly; this covers the
route-level contract, same pattern as test_bed_orientation_removed.py
(#75)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_bed_response_never_includes_an_is_raised_key(client: TestClient) -> None:
    response = client.post(
        "/api/beds", json={"name": "Test Bed", "border_geometry": rectangle(), "height_cm": 70}
    )
    assert response.status_code == 201, response.text
    assert "is_raised" not in response.json()

    bed_id = response.json()["id"]
    get_response = client.get(f"/api/beds/{bed_id}")
    assert "is_raised" not in get_response.json()

    list_response = client.get("/api/beds")
    assert list_response.status_code == 200
    assert all("is_raised" not in bed for bed in list_response.json())


def test_sending_an_is_raised_field_is_silently_ignored_not_rejected_or_persisted(
    client: TestClient,
) -> None:
    """A client still sending the old `is_raised` field (stale frontend
    build, a saved API request) must not crash and must not end up
    persisted anywhere checkable - FastAPI/Pydantic drops unrecognized
    fields by default."""
    response = client.post(
        "/api/beds",
        json={"name": "Test Bed", "border_geometry": rectangle(), "is_raised": True},
    )
    assert response.status_code == 201, response.text
    assert "is_raised" not in response.json()

    bed_id = response.json()["id"]
    patch_response = client.patch(f"/api/beds/{bed_id}", json={"is_raised": False})
    assert patch_response.status_code == 200
    assert "is_raised" not in patch_response.json()


def test_height_cm_survives_correctly_alongside_the_dropped_is_raised_field(client: TestClient) -> None:
    """The functional requirement's own reasoning: "raised" is purely
    derivable from height_cm > 0 - confirms height_cm itself round-trips
    correctly (both a genuinely raised height and a flat/ground-level 0),
    since that's the one field any "is this bed raised" UI logic should
    now derive from."""
    raised_response = client.post(
        "/api/beds", json={"name": "Raised Bed", "border_geometry": rectangle(), "height_cm": 45}
    )
    assert raised_response.status_code == 201, raised_response.text
    assert raised_response.json()["height_cm"] == 45

    ground_response = client.post(
        "/api/beds", json={"name": "Ground Bed", "border_geometry": rectangle(), "height_cm": 0}
    )
    assert ground_response.status_code == 201, ground_response.text
    assert ground_response.json()["height_cm"] == 0
