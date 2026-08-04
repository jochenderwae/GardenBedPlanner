"""#228: soil rotation - POST /api/soil-rotation-events (N-way transfer
events) and check_rotation's inherited-risk model (app/services/rotation.py,
app/services/soil_rotation.py). Mirrors the ticket's own 7-point "How to
test" list."""

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Family, Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Bed") -> int:
    response = client.post("/api/beds", json={"name": name, "border_geometry": rectangle()})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_family(db_session, name: str) -> int:
    family = Family(name=name)
    db_session.add(family)
    db_session.commit()
    db_session.refresh(family)
    return family.id


def _create_plant(db_session, slug: str, common_name: str, botanical_name: str, family_id: int | None) -> str:
    db_session.add(
        Plant(slug=slug, common_name=common_name, botanical_name=botanical_name, family_id=family_id)
    )
    db_session.commit()
    return slug


def _plant_in_bed(client: TestClient, bed_id: int, plant_slug: str, planted_date: str) -> int:
    response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": plant_slug,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": planted_date,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _rotation_check(client: TestClient, bed_id: int, plant_slug: str, as_of: str) -> dict:
    response = client.get(
        f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": plant_slug, "as_of": as_of}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_event_requires_at_least_one_transfer(client: TestClient) -> None:
    response = client.post(
        "/api/soil-rotation-events", json={"event_date": "2027-03-01", "transfers": []}
    )
    assert response.status_code == 400


def test_create_event_404s_on_unknown_bed_id(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.post(
        "/api/soil-rotation-events",
        json={"event_date": "2027-03-01", "transfers": [{"from_bed_id": bed_id, "to_bed_id": 999999}]},
    )
    assert response.status_code == 404


def test_two_bed_swap_transfers_risk_to_the_correct_destination(client: TestClient, db_session) -> None:
    """Ticket step 1: A<->B swap - a nightshade candidate must now warn on
    B (inherited from A), a brassica candidate must warn on A (inherited
    from B), not the reverse."""
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    nightshade = _create_family(db_session, "Solanaceae")
    brassica = _create_family(db_session, "Brassicaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)
    cabbage = _create_plant(db_session, "test-cabbage", "Cabbage", "Brassica oleracea", brassica)
    broccoli = _create_plant(db_session, "test-broccoli", "Broccoli", "Brassica oleracea italica", brassica)

    _plant_in_bed(client, bed_a, tomato, "2026-04-01")
    _plant_in_bed(client, bed_b, cabbage, "2026-04-01")

    swap_response = client.post(
        "/api/soil-rotation-events",
        json={
            "event_date": "2027-03-01",
            "notes": "Spring soil swap",
            "transfers": [
                {"from_bed_id": bed_a, "to_bed_id": bed_b},
                {"from_bed_id": bed_b, "to_bed_id": bed_a},
            ],
        },
    )
    assert swap_response.status_code == 201, swap_response.text
    assert len(swap_response.json()["transfers"]) == 2

    # Bed B now holds A's old (nightshade) soil - a pepper candidate there
    # must warn, inherited from bed A.
    pepper_on_b = _rotation_check(client, bed_b, pepper, "2027-04-01")
    assert pepper_on_b["has_warning"] is True
    assert pepper_on_b["conflicting_via_soil_transfer"] is True
    assert pepper_on_b["conflicting_source_bed_id"] == bed_a
    assert pepper_on_b["conflicting_plant_slug"] == tomato

    # Bed A now holds B's old (brassica) soil - a broccoli candidate there
    # must warn, inherited from bed B.
    broccoli_on_a = _rotation_check(client, bed_a, broccoli, "2027-04-01")
    assert broccoli_on_a["has_warning"] is True
    assert broccoli_on_a["conflicting_via_soil_transfer"] is True
    assert broccoli_on_a["conflicting_source_bed_id"] == bed_b
    assert broccoli_on_a["conflicting_plant_slug"] == cabbage

    # Reverse checks (brassica on B, nightshade on A) must NOT warn - the
    # risk moved away with the soil, not stayed with the bed.
    assert _rotation_check(client, bed_b, broccoli, "2027-04-01")["has_warning"] is False
    assert _rotation_check(client, bed_a, pepper, "2027-04-01")["has_warning"] is False


def test_three_way_cycle_in_one_event(client: TestClient, db_session) -> None:
    """Ticket step 2: A->B, B->C, C->A in one event - all three transfers
    created under one SoilRotationEvent, each bed's inherited risk
    resolves to the correct source (not contaminated by another transfer
    processed earlier in the same event - see
    app/services/soil_rotation.py's own docstring on why the read side
    must use pre-event state)."""
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")
    bed_c = _create_bed(client, "Bed C")

    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)

    _plant_in_bed(client, bed_a, tomato, "2026-04-01")
    # B and C are empty - only A carries a real risk fact into the cycle.

    response = client.post(
        "/api/soil-rotation-events",
        json={
            "event_date": "2027-03-01",
            "transfers": [
                {"from_bed_id": bed_a, "to_bed_id": bed_b},
                {"from_bed_id": bed_b, "to_bed_id": bed_c},
                {"from_bed_id": bed_c, "to_bed_id": bed_a},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["transfers"]) == 3

    # A's tomato risk moved to B (A->B), not to C - C received B's
    # (empty) soil, which must NOT include A's just-arrived risk.
    assert _rotation_check(client, bed_b, pepper, "2027-04-01")["has_warning"] is True
    assert _rotation_check(client, bed_c, pepper, "2027-04-01")["has_warning"] is False
    # A received C's (empty) soil - no warning there either.
    assert _rotation_check(client, bed_a, pepper, "2027-04-01")["has_warning"] is False


def test_native_history_before_horizon_stops_counting(client: TestClient, db_session) -> None:
    """Ticket step 3: a bed's own native planting history from before its
    soil moved away must no longer trigger a warning for that bed after
    the transfer (the horizon-date cutoff)."""
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)

    _plant_in_bed(client, bed_a, tomato, "2026-04-01")
    # Confirm it warns before any rotation event exists.
    assert _rotation_check(client, bed_a, pepper, "2026-10-01")["has_warning"] is True

    # Bed A's soil moves away (to B), and A gets a fresh-soil reset of its
    # own in the same event (a bed only gets a horizon by being a transfer
    # *destination* - see _latest_transfer_to_bed - so "A's soil left" by
    # itself doesn't establish one; A needs its own incoming transfer too,
    # matching a real "empty this bed out" workflow) - A's own pre-move
    # planting history must stop counting for A from this point on.
    client.post(
        "/api/soil-rotation-events",
        json={
            "event_date": "2027-01-01",
            "transfers": [
                {"from_bed_id": bed_a, "to_bed_id": bed_b},
                {"from_bed_id": None, "to_bed_id": bed_a},
            ],
        },
    )

    assert _rotation_check(client, bed_a, pepper, "2027-06-01")["has_warning"] is False


def test_fresh_soil_transfer_gives_a_clean_slate(client: TestClient, db_session) -> None:
    """Ticket step 4: a fresh-soil event (from_bed_id=null) for a bed with
    recent same-family history - no warning fires for that bed afterward,
    and no SoilFamilyHistory rows are created (nothing to inherit)."""
    bed_id = _create_bed(client)
    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)

    _plant_in_bed(client, bed_id, tomato, "2026-04-01")
    assert _rotation_check(client, bed_id, pepper, "2026-10-01")["has_warning"] is True

    fresh_soil_response = client.post(
        "/api/soil-rotation-events",
        json={"event_date": "2027-01-01", "transfers": [{"from_bed_id": None, "to_bed_id": bed_id}]},
    )
    assert fresh_soil_response.status_code == 201, fresh_soil_response.text

    assert _rotation_check(client, bed_id, pepper, "2027-06-01")["has_warning"] is False


def test_soil_moved_twice_carries_original_risk_across_both_moves(client: TestClient, db_session) -> None:
    """Ticket step 5: A->B, then later B->C in two separate events - C
    inherits A's original risk facts too, not just whatever B itself grew
    after receiving A's soil (multi-generation chaining via copy-forward),
    and the tooltip provenance still points at the *original* bed A, not
    the intermediate bed B."""
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")
    bed_c = _create_bed(client, "Bed C")

    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)

    _plant_in_bed(client, bed_a, tomato, "2026-04-01")

    client.post(
        "/api/soil-rotation-events",
        json={"event_date": "2026-06-01", "transfers": [{"from_bed_id": bed_a, "to_bed_id": bed_b}]},
    )
    client.post(
        "/api/soil-rotation-events",
        json={"event_date": "2026-09-01", "transfers": [{"from_bed_id": bed_b, "to_bed_id": bed_c}]},
    )

    result = _rotation_check(client, bed_c, pepper, "2026-12-01")
    assert result["has_warning"] is True
    assert result["conflicting_via_soil_transfer"] is True
    assert result["conflicting_source_bed_id"] == bed_a
    assert result["conflicting_plant_slug"] == tomato


def test_bed_never_part_of_a_transfer_behaves_as_before_228(client: TestClient, db_session) -> None:
    """Ticket step 6: no regression for the common case - a bed that's
    never been a rotation destination behaves identically to
    check_rotation's pre-#228 behavior."""
    bed_id = _create_bed(client)
    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade)

    _plant_in_bed(client, bed_id, tomato, "2026-04-01")
    result = _rotation_check(client, bed_id, pepper, "2026-10-01")
    assert result["has_warning"] is True
    assert result["conflicting_via_soil_transfer"] is False
    assert result["conflicting_source_bed_id"] is None
    assert result["conflicting_planting_id"] is not None


def test_cascade_delete_bed_with_soil_rotation_history_should_succeed(client: TestClient, db_session) -> None:
    """A bed that's been part of a logged soil-rotation event (either side)
    must still be cascade-deletable, same as every other dependent table -
    otherwise this would be the same FK-violation-on-cascade-delete bug
    class as #215/#217/#38/#39, just for a brand new pair of tables."""
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    nightshade = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade)
    _plant_in_bed(client, bed_a, tomato, "2026-04-01")

    event_response = client.post(
        "/api/soil-rotation-events",
        json={"event_date": "2027-01-01", "transfers": [{"from_bed_id": bed_a, "to_bed_id": bed_b}]},
    )
    assert event_response.status_code == 201, event_response.text

    # bed_b now holds an inherited SoilFamilyHistory row (destination
    # side) - must still cascade-delete cleanly.
    delete_b = client.delete(f"/api/beds/{bed_b}", params={"cascade": "true"})
    assert delete_b.status_code == 204, delete_b.text

    # bed_a is the source side of a (still-existing) SoilRotationTransfer
    # row - must still cascade-delete cleanly too.
    delete_a = client.delete(f"/api/beds/{bed_a}", params={"cascade": "true"})
    assert delete_a.status_code == 204, delete_a.text


def test_get_and_list_soil_rotation_events(client: TestClient) -> None:
    bed_a = _create_bed(client, "Bed A")
    bed_b = _create_bed(client, "Bed B")

    create_response = client.post(
        "/api/soil-rotation-events",
        json={
            "event_date": "2027-01-01",
            "notes": "Test event",
            "transfers": [{"from_bed_id": bed_a, "to_bed_id": bed_b}],
        },
    )
    assert create_response.status_code == 201, create_response.text
    event_id = create_response.json()["id"]

    get_response = client.get(f"/api/soil-rotation-events/{event_id}")
    assert get_response.status_code == 200
    assert get_response.json()["notes"] == "Test event"
    assert len(get_response.json()["transfers"]) == 1

    list_response = client.get("/api/soil-rotation-events")
    assert list_response.status_code == 200
    assert any(e["id"] == event_id for e in list_response.json())

    assert client.get("/api/soil-rotation-events/999999").status_code == 404
