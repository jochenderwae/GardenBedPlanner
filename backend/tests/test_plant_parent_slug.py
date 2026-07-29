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


def test_parent_plant_slug_can_be_cleared_via_patch(client: TestClient) -> None:
    """Unlinking a cultivar back to standalone - the null-clears-it half
    of PATCH, distinct from setting it in the first place."""
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
            "parent_plant_slug": "test-tomato",
        },
    )

    response = client.patch("/api/plants/test-tomato-brandywine", json={"parent_plant_slug": None})
    assert response.status_code == 200
    assert response.json()["parent_plant_slug"] is None


def test_listing_plants_and_filtering_client_side_resolves_a_species_cultivars(client: TestClient) -> None:
    """The ticket's own "How to test" step 2 - `list_plants` has no
    dedicated parent_plant_slug query param, so "the relationship
    resolves correctly" is checked the way any actual API consumer would
    have to: fetch the list and filter by the field, same shape as the
    implementer's own direct-SQL WHERE parent_plant_slug = 'tomato'
    verification, just through the real HTTP surface instead."""
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
            "parent_plant_slug": "test-tomato",
        },
    )
    client.post(
        "/api/plants",
        json={
            "slug": "test-tomato-cherry",
            "common_name": "Cherry Tomato",
            "botanical_name": "Solanum lycopersicum var. cerasiforme",
            "parent_plant_slug": "test-tomato",
        },
    )
    client.post(
        "/api/plants",
        json={"slug": "test-carrot", "common_name": "Carrot", "botanical_name": "Daucus carota"},
    )

    all_plants = client.get("/api/plants").json()
    cultivars = [p["slug"] for p in all_plants if p["parent_plant_slug"] == "test-tomato"]
    assert set(cultivars) == {"test-tomato-brandywine", "test-tomato-cherry"}


def test_deleting_a_species_with_a_linked_cultivar_is_a_clean_409_not_a_500(client: TestClient) -> None:
    """parent_plant_slug is a self-referencing FK that delete_plant's own
    satellite cleanup doesn't touch at all - same intentional-block
    pattern already confirmed for other tables referencing a Plant (#40's
    SeedInventoryItem, #42's HarvestLog): a species still linked from a
    cultivar blocks deletion via a clean FK violation, not an unhandled
    500. Confirmed rather than assumed from reading the route."""
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
            "parent_plant_slug": "test-tomato",
        },
    )

    response = client.delete("/api/plants/test-tomato")
    assert response.status_code == 409, response.text
    # Neither plant was actually touched - a clean rollback, not a
    # partial delete.
    assert client.get("/api/plants/test-tomato").status_code == 200
    assert client.get("/api/plants/test-tomato-brandywine").status_code == 200
