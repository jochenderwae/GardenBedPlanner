"""Plant.water_needs_mm_per_week (#138) - replaces the old free-text
water_needs string column (#137 converted data/plants/*.json to match).
Same style as test_plant_growth_habit.py's coverage of another plain
scalar Plant column, plus a couple of numeric-specific edge cases
(negative/zero/fractional values, string rejection) growth_habit's
free-text field didn't need."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_plant_without_water_needs_defaults_to_none(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={"slug": "test-mystery-plant", "common_name": "Mystery", "botanical_name": "Mysterium sp."},
    )
    assert response.status_code == 201, response.text
    assert response.json()["water_needs_mm_per_week"] is None

    detail_response = client.get("/api/plants/test-mystery-plant")
    assert detail_response.status_code == 200
    assert detail_response.json()["water_needs_mm_per_week"] is None


def test_water_needs_round_trips_through_create_and_detail(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-tomato",
            "common_name": "Tomato",
            "botanical_name": "Solanum lycopersicum",
            "water_needs_mm_per_week": 25.4,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["water_needs_mm_per_week"] == 25.4

    detail_response = client.get("/api/plants/test-tomato")
    assert detail_response.status_code == 200
    assert detail_response.json()["water_needs_mm_per_week"] == 25.4


def test_water_needs_can_be_set_via_patch(client: TestClient) -> None:
    client.post(
        "/api/plants",
        json={"slug": "test-cucumber", "common_name": "Cucumber", "botanical_name": "Cucumis sativus"},
    )

    update_response = client.patch("/api/plants/test-cucumber", json={"water_needs_mm_per_week": 38.1})
    assert update_response.status_code == 200
    assert update_response.json()["water_needs_mm_per_week"] == 38.1


def test_water_needs_can_be_cleared_back_to_null_via_patch(client: TestClient) -> None:
    """An explicit `"water_needs_mm_per_week": null` in a PATCH body must
    actually clear the column, not be silently ignored - same
    `exclude_unset=True`-vs-explicit-null distinction test_plant_growth_habit.py
    pins down for that field."""
    client.post(
        "/api/plants",
        json={
            "slug": "test-pumpkin",
            "common_name": "Pumpkin",
            "botanical_name": "Cucurbita pepo",
            "water_needs_mm_per_week": 50.8,
        },
    )

    clear_response = client.patch("/api/plants/test-pumpkin", json={"water_needs_mm_per_week": None})
    assert clear_response.status_code == 200
    assert clear_response.json()["water_needs_mm_per_week"] is None

    detail_response = client.get("/api/plants/test-pumpkin")
    assert detail_response.status_code == 200
    assert detail_response.json()["water_needs_mm_per_week"] is None


def test_water_needs_appears_in_list_plants_not_just_detail(client: TestClient) -> None:
    """`Plant` (the flat list/create/update response shape, distinct from
    `PlantDetail`) derives its fields from `PlantTable.model_fields` -
    confirms `water_needs_mm_per_week` actually flowed through that
    derivation into the list endpoint too, not just the hand-duplicated
    `PlantDetail` schema."""
    client.post(
        "/api/plants",
        json={
            "slug": "test-pea",
            "common_name": "Pea",
            "botanical_name": "Pisum sativum",
            "water_needs_mm_per_week": 12.7,
        },
    )

    list_response = client.get("/api/plants")
    assert list_response.status_code == 200
    by_slug = {p["slug"]: p for p in list_response.json()}
    assert "test-pea" in by_slug
    assert by_slug["test-pea"]["water_needs_mm_per_week"] == 12.7


def test_water_needs_accepts_zero(client: TestClient) -> None:
    """No positivity constraint is declared on the model (plain
    `float | None`, unlike e.g. `spread_cm`'s `exclusiveMinimum: 0` in the
    JSON schema) - 0.0 is a legitimate value (a plant needing essentially no
    supplemental watering), not something the API should reject."""
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-cactus",
            "common_name": "Cactus",
            "botanical_name": "Cactaceae sp.",
            "water_needs_mm_per_week": 0,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["water_needs_mm_per_week"] == 0


def test_water_needs_accepts_a_fractional_value_not_just_whole_millimeters(client: TestClient) -> None:
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-lavender",
            "common_name": "Lavender",
            "botanical_name": "Lavandula sp.",
            "water_needs_mm_per_week": 6.3,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["water_needs_mm_per_week"] == 6.3


def test_water_needs_rejects_a_non_numeric_string(client: TestClient) -> None:
    """The field is genuinely numeric now (#138 dropped the old free-text
    `water_needs` string column entirely per #137) - a string value like the
    pre-migration `"~1.0 in/week"` format must be rejected with a 422, not
    silently coerced or accepted."""
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-basil",
            "common_name": "Basil",
            "botanical_name": "Ocimum basilicum",
            "water_needs_mm_per_week": "~1.0 in/week",
        },
    )
    assert response.status_code == 422


def test_old_water_needs_field_name_is_silently_ignored_not_persisted(client: TestClient) -> None:
    """Sending the old field name (`water_needs`, pre-#138 shape) shouldn't
    crash the request - FastAPI/Pydantic just ignores an unrecognized field
    by default - but it also must not somehow end up persisted anywhere
    checkable; the created plant should simply have no water_needs_mm_per_week
    value from it."""
    response = client.post(
        "/api/plants",
        json={
            "slug": "test-old-field-name",
            "common_name": "Old Field Name Plant",
            "botanical_name": "Testus e2eus",
            "water_needs": "~1.0 in/week",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["water_needs_mm_per_week"] is None
    assert "water_needs" not in response.json()
