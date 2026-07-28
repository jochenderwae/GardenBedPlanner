"""Plant.sow_indoors/sow_direct/needs_thinning (#196) - true-or-null
boolean flags extracted from unstructured growing-info text (#177); never
a derived false. Same style as test_plant_water_needs.py/
test_plant_spacing_cm.py's coverage of other plain scalar Plant columns."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_plant_without_sowing_flags_defaults_all_to_none(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={"slug": "test-mystery-plant", "common_name": "Mystery", "botanical_name": "Mysterium sp."},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sow_indoors"] is None
    assert body["sow_direct"] is None
    assert body["needs_thinning"] is None

    detail_response = client.get("/api/plants/test-mystery-plant")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["sow_indoors"] is None
    assert detail["sow_direct"] is None
    assert detail["needs_thinning"] is None


def test_sowing_flags_round_trip_through_create_and_detail(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-tomato",
            "common_name": "Tomato",
            "botanical_name": "Solanum lycopersicum",
            "sow_indoors": True,
            "sow_direct": False,
            "needs_thinning": True,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sow_indoors"] is True
    assert body["sow_direct"] is False
    assert body["needs_thinning"] is True

    detail_response = client.get("/api/plants/test-tomato")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["sow_indoors"] is True
    assert detail["sow_direct"] is False
    assert detail["needs_thinning"] is True


def test_each_sowing_flag_can_be_set_independently_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={"slug": "test-carrot", "common_name": "Carrot", "botanical_name": "Daucus carota"},
    )

    response = client.patch("/api/plants/test-carrot", json={"sow_direct": True})
    assert response.status_code == 200
    body = response.json()
    assert body["sow_direct"] is True
    # Untouched flags stay null, not silently set to false.
    assert body["sow_indoors"] is None
    assert body["needs_thinning"] is None

    response = client.patch("/api/plants/test-carrot", json={"needs_thinning": True})
    assert response.status_code == 200
    body = response.json()
    assert body["sow_direct"] is True
    assert body["needs_thinning"] is True
    assert body["sow_indoors"] is None


def test_sowing_flags_can_be_cleared_back_to_null_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={
            "slug": "test-pumpkin",
            "common_name": "Pumpkin",
            "botanical_name": "Cucurbita pepo",
            "sow_indoors": True,
            "sow_direct": True,
            "needs_thinning": True,
        },
    )

    clear_response = client.patch(
        "/api/plants/test-pumpkin",
        json={"sow_indoors": None, "sow_direct": None, "needs_thinning": None},
    )
    assert clear_response.status_code == 200
    body = clear_response.json()
    assert body["sow_indoors"] is None
    assert body["sow_direct"] is None
    assert body["needs_thinning"] is None

    detail_response = client.get("/api/plants/test-pumpkin")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["sow_indoors"] is None
    assert detail["sow_direct"] is None
    assert detail["needs_thinning"] is None


def test_sowing_flags_appear_in_list_plants_not_just_detail(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={
            "slug": "test-pea",
            "common_name": "Pea",
            "botanical_name": "Pisum sativum",
            "sow_direct": True,
        },
    )

    list_response = client.get("/api/plants")
    assert list_response.status_code == 200
    by_slug = {p["slug"]: p for p in list_response.json()}
    assert "test-pea" in by_slug
    assert by_slug["test-pea"]["sow_direct"] is True
    assert by_slug["test-pea"]["sow_indoors"] is None


def test_sowing_flags_reject_non_boolean_values(client: TestClient) -> None:
    # Pydantic's bool coercion accepts several string forms ("true"/"yes"/
    # "1"/etc.) - an object is unambiguously not one of them.
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-basil",
            "common_name": "Basil",
            "botanical_name": "Ocimum basilicum",
            "sow_indoors": {"unexpected": "object"},
        },
    )
    assert response.status_code == 422
