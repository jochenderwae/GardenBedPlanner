"""Plant.growth_habit (#131) - free-text habit vocabulary (vining/bushy/
upright/spreading/...) already populated in data/plants/*.json by
populate_growth_habit.py, exposed here as a plain scalar column/API field,
same style as soil_type/composting_needs."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_plant_without_growth_habit_defaults_to_none(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={"slug": "test-mystery-plant", "common_name": "Mystery", "botanical_name": "Mysterium sp."},
    )
    assert response.status_code == 201, response.text
    assert response.json()["growth_habit"] is None

    detail_response = client.get("/api/plants/test-mystery-plant")
    assert detail_response.status_code == 200
    assert detail_response.json()["growth_habit"] is None


def test_growth_habit_round_trips_through_create_and_detail(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-tomato",
            "common_name": "Tomato",
            "botanical_name": "Solanum lycopersicum",
            "growth_habit": "upright",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["growth_habit"] == "upright"

    detail_response = client.get("/api/plants/test-tomato")
    assert detail_response.status_code == 200
    assert detail_response.json()["growth_habit"] == "upright"


def test_growth_habit_can_be_set_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={"slug": "test-cucumber", "common_name": "Cucumber", "botanical_name": "Cucumis sativus"},
    )

    update_response = client.patch("/api/plants/test-cucumber", json={"growth_habit": "vining"})
    assert update_response.status_code == 200
    assert update_response.json()["growth_habit"] == "vining"
