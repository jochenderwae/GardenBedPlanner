"""SeedInventoryItem CRUD (see app/models/seed_inventory_item.py,
app/api/routes/seed_inventory_items.py) - count-based or weight-based seed
stock, linked to a plant."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Plant

pytestmark = pytest.mark.integration


def _create_plant(db_session, slug: str = "test-tomato") -> str:
    db_session.add(Plant(slug=slug, common_name="Tomato", botanical_name="Solanum lycopersicum"))
    db_session.commit()
    return slug


def test_get_missing_seed_inventory_item_404(client: TestClient) -> None:
    assert client.get("/api/seed-inventory-items/999999").status_code == 404


def test_create_seed_inventory_item_bad_plant_slug_returns_409(client: TestClient) -> None:
    response = client.post(
        "/api/seed-inventory-items", json={"plant_slug": "no-such-plant", "quantity_seeds": 12}
    )
    assert response.status_code == 409


def test_seed_inventory_item_count_based_round_trip(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session)
    create_response = client.post(
        "/api/seed-inventory-items",
        json={"plant_slug": plant_slug, "quantity_seeds": 24, "acquired_date": "2027-01-15"},
    )
    assert create_response.status_code == 201, create_response.text
    item = create_response.json()
    assert item["quantity_seeds"] == 24
    assert item["weight_grams"] is None
    item_id = item["id"]

    update_response = client.patch(
        f"/api/seed-inventory-items/{item_id}", json={"quantity_seeds": 18}
    )
    assert update_response.status_code == 200
    assert update_response.json()["quantity_seeds"] == 18

    delete_response = client.delete(f"/api/seed-inventory-items/{item_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/seed-inventory-items/{item_id}").status_code == 404


def test_seed_inventory_item_weight_based_round_trip(client: TestClient, db_session) -> None:
    plant_slug = _create_plant(db_session, "test-carrot")
    create_response = client.post(
        "/api/seed-inventory-items", json={"plant_slug": plant_slug, "weight_grams": 5.0}
    )
    assert create_response.status_code == 201, create_response.text
    item = create_response.json()
    assert item["weight_grams"] == 5.0
    assert item["quantity_seeds"] is None


def test_list_seed_inventory_items_filters_by_plant(client: TestClient, db_session) -> None:
    tomato_slug = _create_plant(db_session, "test-tomato")
    carrot_slug = _create_plant(db_session, "test-carrot")

    tomato_item_id = client.post(
        "/api/seed-inventory-items", json={"plant_slug": tomato_slug, "quantity_seeds": 10}
    ).json()["id"]
    client.post("/api/seed-inventory-items", json={"plant_slug": carrot_slug, "weight_grams": 2.0})

    response = client.get("/api/seed-inventory-items", params={"plant_slug": tomato_slug})
    assert response.status_code == 200
    ids = [i["id"] for i in response.json()]
    assert ids == [tomato_item_id]


def test_list_seed_inventory_items_with_no_filter_returns_every_plant(client: TestClient, db_session) -> None:
    tomato_slug = _create_plant(db_session, "test-tomato")
    carrot_slug = _create_plant(db_session, "test-carrot")

    tomato_item_id = client.post(
        "/api/seed-inventory-items", json={"plant_slug": tomato_slug, "quantity_seeds": 10}
    ).json()["id"]
    carrot_item_id = client.post(
        "/api/seed-inventory-items", json={"plant_slug": carrot_slug, "weight_grams": 2.0}
    ).json()["id"]

    response = client.get("/api/seed-inventory-items")
    assert response.status_code == 200
    ids = {i["id"] for i in response.json()}
    assert {tomato_item_id, carrot_item_id} <= ids


def test_seed_inventory_item_with_neither_quantity_type_is_valid(client: TestClient, db_session) -> None:
    """Both quantity_seeds/weight_grams are nullable per the model's own
    design - "we have some seeds, exact amount not tracked yet" is a
    legitimate row, not something the API should reject."""
    plant_slug = _create_plant(db_session)
    response = client.post("/api/seed-inventory-items", json={"plant_slug": plant_slug})
    assert response.status_code == 201, response.text
    assert response.json()["quantity_seeds"] is None
    assert response.json()["weight_grams"] is None


def test_deleting_a_plant_with_seed_inventory_items_is_a_clean_409_not_a_500(client: TestClient, db_session) -> None:
    """SeedInventoryItem.plant_slug isn't among the satellite tables
    delete_plant explicitly clears (app/api/routes/plants.py's own bulk-
    delete list) - same intentional-block pattern as garden_plan_entry/
    action/planting references the route's own comment already documents
    (a plant still "in use" elsewhere blocks deletion via a clean FK
    violation -> 409, rather than silently orphaning/losing that data).
    Confirms that's actually what happens for seed inventory specifically,
    not assumed from reading the route alone."""
    plant_slug = _create_plant(db_session)
    client.post("/api/seed-inventory-items", json={"plant_slug": plant_slug, "quantity_seeds": 10})

    response = client.delete(f"/api/plants/{plant_slug}")
    assert response.status_code == 409, response.text
    # The plant must still exist - the failed delete was rolled back
    # cleanly, not left in some partial state.
    assert client.get(f"/api/plants/{plant_slug}").status_code == 200
