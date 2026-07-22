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


def test_growth_habit_can_be_cleared_back_to_null_via_patch(client: TestClient) -> None:
    """An explicit `"growth_habit": null` in a PATCH body must actually clear
    the column, not be silently ignored - `update_plant`'s `exclude_unset=True`
    only excludes fields absent from the request body entirely, not fields
    present with a null value, but that distinction is exactly the kind of
    thing worth a real regression test rather than trusting by inspection."""
    client.post(
        "/api/plants",
        json={
            "slug": "test-pumpkin",
            "common_name": "Pumpkin",
            "botanical_name": "Cucurbita pepo",
            "growth_habit": "spreading",
        },
    )

    clear_response = client.patch("/api/plants/test-pumpkin", json={"growth_habit": None})
    assert clear_response.status_code == 200
    assert clear_response.json()["growth_habit"] is None

    detail_response = client.get("/api/plants/test-pumpkin")
    assert detail_response.status_code == 200
    assert detail_response.json()["growth_habit"] is None


def test_growth_habit_appears_in_list_plants_not_just_detail(client: TestClient) -> None:
    """`Plant` (the flat list/create/update response shape, distinct from
    `PlantDetail`) derives its fields from `PlantTable.model_fields` - this
    confirms `growth_habit` actually flowed through that derivation into the
    list endpoint too, not just the hand-duplicated `PlantDetail` schema."""
    client.post(
        "/api/plants",
        json={
            "slug": "test-pea",
            "common_name": "Pea",
            "botanical_name": "Pisum sativum",
            "growth_habit": "climbing",
        },
    )

    list_response = client.get("/api/plants")
    assert list_response.status_code == 200
    by_slug = {p["slug"]: p for p in list_response.json()}
    assert "test-pea" in by_slug
    assert by_slug["test-pea"]["growth_habit"] == "climbing"


def test_growth_habit_accepts_arbitrary_free_text_not_just_the_etl_vocabulary(client: TestClient) -> None:
    """No fixed enum is enforced at the API layer (per the ticket's own
    technical analysis) - a value outside the ETL's known
    upright/spreading/climbing/rosette/tree vocabulary must still be
    accepted, not rejected as invalid. (The frontend's `PlantFootprint.tsx`
    separately falls back to a plain circle for anything it doesn't
    recognize - that's a rendering concern, not a data-validation one.)"""
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-weird-habit",
            "common_name": "Weird",
            "botanical_name": "Weirdus sp.",
            "growth_habit": "some totally made-up habit",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["growth_habit"] == "some totally made-up habit"
