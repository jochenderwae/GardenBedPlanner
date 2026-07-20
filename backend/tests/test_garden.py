"""GET /api/garden 404-before-first-PUT contract, and PUT create/update
(get-or-create) semantics - including the one-time auto-created "Ground"
Bed side effect (see app/api/routes/garden.py's put_garden docstring)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_get_garden_404_before_first_put(client: TestClient) -> None:
    response = client.get("/api/garden")
    assert response.status_code == 404


def test_put_garden_creates_then_updates(client: TestClient) -> None:
    create_response = client.put(
        "/api/garden",
        json={
            "name": "My Garden",
            "border_geometry": rectangle(width=1000, height=800),
            "climate_zone": "8b",
            "location": "Belgium",
            "orientation_deg": 15.0,
            "notes": "",
        },
    )
    assert create_response.status_code == 200, create_response.text
    garden = create_response.json()
    assert garden["name"] == "My Garden"
    assert garden["orientation_deg"] == 15.0

    # First creation auto-creates a matching ground-level Bed.
    beds = client.get("/api/beds").json()
    assert any(b["name"] == "Ground" for b in beds)
    ground_bed_count = sum(1 for b in beds if b["name"] == "Ground")
    assert ground_bed_count == 1

    update_response = client.put(
        "/api/garden",
        json={
            "name": "My Garden",
            "border_geometry": rectangle(width=1200, height=900),
            "climate_zone": "8b",
            "location": "Belgium",
            "orientation_deg": 30.0,
            "notes": "updated",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["orientation_deg"] == 30.0
    assert update_response.json()["notes"] == "updated"

    # Second PUT must not create a second ground bed.
    beds_after_update = client.get("/api/beds").json()
    assert sum(1 for b in beds_after_update if b["name"] == "Ground") == 1
