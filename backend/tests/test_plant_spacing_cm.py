"""Plant.plant_spacing_cm (#194) - in-row spacing between individual
plants, distinct from row_spacing_cm (the gap between rows). Same style as
test_plant_water_needs.py's coverage of another plain scalar Plant
column."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_plant_without_plant_spacing_cm_defaults_to_none(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={"slug": "test-mystery-plant", "common_name": "Mystery", "botanical_name": "Mysterium sp."},
    )
    assert response.status_code == 201, response.text
    assert response.json()["plant_spacing_cm"] is None

    detail_response = client.get("/api/plants/test-mystery-plant")
    assert detail_response.status_code == 200
    assert detail_response.json()["plant_spacing_cm"] is None


def test_plant_spacing_cm_round_trips_through_create_and_detail(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-carrot",
            "common_name": "Carrot",
            "botanical_name": "Daucus carota",
            "row_spacing_cm": 30.0,
            "plant_spacing_cm": 5.0,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["plant_spacing_cm"] == 5.0
    # Distinct from row_spacing_cm, not derived/overwritten from it.
    assert response.json()["row_spacing_cm"] == 30.0

    detail_response = client.get("/api/plants/test-carrot")
    assert detail_response.status_code == 200
    assert detail_response.json()["plant_spacing_cm"] == 5.0


def test_plant_spacing_cm_can_be_set_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={"slug": "test-cucumber", "common_name": "Cucumber", "botanical_name": "Cucumis sativus"},
    )

    update_response = client.patch("/api/plants/test-cucumber", json={"plant_spacing_cm": 45.0})
    assert update_response.status_code == 200
    assert update_response.json()["plant_spacing_cm"] == 45.0


def test_plant_spacing_cm_can_be_cleared_back_to_null_via_patch(client: TestClient) -> None:
    """An explicit `"plant_spacing_cm": null` in a PATCH body must actually
    clear the column, not be silently ignored - same exclude_unset=True-vs-
    explicit-null distinction test_plant_water_needs.py pins down for that
    field."""
    client.post(
        "/api/plants",
        json={
            "slug": "test-pumpkin",
            "common_name": "Pumpkin",
            "botanical_name": "Cucurbita pepo",
            "plant_spacing_cm": 90.0,
        },
    )

    clear_response = client.patch("/api/plants/test-pumpkin", json={"plant_spacing_cm": None})
    assert clear_response.status_code == 200
    assert clear_response.json()["plant_spacing_cm"] is None

    detail_response = client.get("/api/plants/test-pumpkin")
    assert detail_response.status_code == 200
    assert detail_response.json()["plant_spacing_cm"] is None


def test_plant_spacing_cm_appears_in_list_plants_not_just_detail(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={
            "slug": "test-pea",
            "common_name": "Pea",
            "botanical_name": "Pisum sativum",
            "plant_spacing_cm": 7.5,
        },
    )

    list_response = client.get("/api/plants")
    assert list_response.status_code == 200
    by_slug = {p["slug"]: p for p in list_response.json()}
    assert "test-pea" in by_slug
    assert by_slug["test-pea"]["plant_spacing_cm"] == 7.5


def test_plant_spacing_cm_rejects_a_non_numeric_string(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-basil",
            "common_name": "Basil",
            "botanical_name": "Ocimum basilicum",
            "plant_spacing_cm": "wide",
        },
    )
    assert response.status_code == 422
