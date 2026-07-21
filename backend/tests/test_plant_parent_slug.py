"""Plant.parent_plant_slug (#110) - cultivar-to-species linkage via a
nullable self-referencing FK, not a separate Cultivar entity (see #64's
design-decision comment)."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_plant_without_parent_slug_defaults_to_none(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={"slug": "test-tomato", "common_name": "Tomato", "botanical_name": "Solanum lycopersicum"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["parent_plant_slug"] is None


def test_cultivar_can_link_to_its_species(client: TestClient) -> None:
    species_response = client.post(
        "/api/plants",
        json={"slug": "test-tomato", "common_name": "Tomato", "botanical_name": "Solanum lycopersicum"},
    )
    assert species_response.status_code == 201, species_response.text

    cultivar_response = client.post(
        "/api/plants",
        json={
            "slug": "test-tomato-brandywine",
            "common_name": "Brandywine Tomato",
            "botanical_name": "Solanum lycopersicum",
            "parent_plant_slug": "test-tomato",
        },
    )
    assert cultivar_response.status_code == 201, cultivar_response.text
    assert cultivar_response.json()["parent_plant_slug"] == "test-tomato"

    detail_response = client.get("/api/plants/test-tomato-brandywine")
    assert detail_response.status_code == 200
    assert detail_response.json()["parent_plant_slug"] == "test-tomato"


def test_parent_plant_slug_can_be_set_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={"slug": "test-tomato", "common_name": "Tomato", "botanical_name": "Solanum lycopersicum"},
    )
    client.post(
        "/api/plants",
        json={
            "slug": "test-tomato-brandywine",
            "common_name": "Brandywine Tomato",
            "botanical_name": "Solanum lycopersicum",
        },
    )

    update_response = client.patch(
        "/api/plants/test-tomato-brandywine", json={"parent_plant_slug": "test-tomato"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["parent_plant_slug"] == "test-tomato"


def test_invalid_parent_plant_slug_returns_409(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-tomato-brandywine",
            "common_name": "Brandywine Tomato",
            "botanical_name": "Solanum lycopersicum",
            "parent_plant_slug": "no-such-species",
        },
    )
    assert response.status_code == 409
