"""Family-based rotation/succession warnings (see app/services/rotation.py,
app/api/routes/rotation.py) - GET /api/beds/{bed_id}/rotation-check."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.models.plant import Family, Plant
from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def _create_bed(client: TestClient, name: str = "Bed") -> int:
    response = client.post("/api/beds", json={"name": name, "border_geometry": rectangle()})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_plant(db_session, slug: str, common_name: str, botanical_name: str, family_id: int | None) -> str:
    db_session.add(
        Plant(slug=slug, common_name=common_name, botanical_name=botanical_name, family_id=family_id)
    )
    db_session.commit()
    return slug


def _create_family(db_session, name: str) -> int:
    family = Family(name=name)
    db_session.add(family)
    db_session.commit()
    db_session.refresh(family)
    return family.id


def test_rotation_check_404_for_missing_bed(client: TestClient) -> None:
    response = client.get("/api/beds/999999/rotation-check", params={"plant_slug": "no-such-plant"})
    assert response.status_code == 404


def test_rotation_check_404_for_missing_plant(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.get(f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": "no-such-plant"})
    assert response.status_code == 404


def test_rotation_check_no_warning_when_bed_empty(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)

    response = client.get(f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": tomato})
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_warns_on_recent_same_family_planting(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    create_response = client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )
    assert create_response.status_code == 201, create_response.text

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_warning"] is True
    assert body["family_name"] == "Solanaceae"
    assert body["conflicting_plant_slug"] == tomato
    assert body["conflicting_plant_common_name"] == "Tomato"


def test_rotation_check_no_warning_for_different_family(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    legume_family = _create_family(db_session, "Fabaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    bean = _create_plant(db_session, "test-bean", "Bean", "Phaseolus vulgaris", legume_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": bean, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_no_warning_when_outside_lookback_window(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2020-04-01",
            "removed_date": "2020-09-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_no_warning_when_candidate_has_no_family(client: TestClient, db_session) -> None:
    """`check_rotation` returns early (`has_warning=False`) when the
    *candidate* plant has no `family_id` at all - can't compare families
    against nothing, so this must never crash or false-positive."""
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    mystery = _create_plant(db_session, "test-mystery", "Mystery Plant", "Mysterium sp.", None)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": mystery, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_ignores_a_same_family_planting_with_no_planted_date(client: TestClient, db_session) -> None:
    """A planting with no `planted_date` on file can't be dated, so it's
    conservatively excluded rather than assumed recent (see
    `check_rotation`'s own docstring)."""
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": None,
            "removed_date": None,
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False


def test_rotation_check_a_still_active_planting_with_no_removed_date_still_counts(client: TestClient, db_session) -> None:
    """`removed_date` isn't part of the recency filter at all - a crop
    that's still in the ground (planted, never removed) must still trigger
    the warning if its `planted_date` is within the lookback window."""
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": None,
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is True
    assert response.json()["conflicting_removed_date"] is None


def test_rotation_check_lookback_window_boundary_is_inclusive(client: TestClient, db_session) -> None:
    """`cutoff = as_of - lookback_days`, and the comparison is
    `cutoff <= planted_date <= as_of` (both ends inclusive) - a planting
    dated exactly at the cutoff must still warn; one day further back must
    not."""
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    # as_of=2026-10-01, lookback_days=10 -> cutoff=2026-09-21 exactly.
    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-09-21",
            "removed_date": None,
        },
    )
    at_cutoff = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01", "lookback_days": 10},
    )
    assert at_cutoff.status_code == 200
    assert at_cutoff.json()["has_warning"] is True

    # Move the same planting one day further back (now outside the window)
    # via a fresh bed, so the two checks don't interfere with each other.
    bed_id_2 = _create_bed(client, "Bed 2")
    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id_2,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-09-20",
            "removed_date": None,
        },
    )
    outside_cutoff = client.get(
        f"/api/beds/{bed_id_2}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01", "lookback_days": 10},
    )
    assert outside_cutoff.status_code == 200
    assert outside_cutoff.json()["has_warning"] is False


def test_rotation_check_respects_a_custom_lookback_days_override(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-06-01",
            "removed_date": None,
        },
    )

    # Default (730-day) lookback from 2026-10-01 easily covers 2026-06-01.
    default_response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert default_response.json()["has_warning"] is True

    # A short, explicit lookback (30 days) does not.
    short_response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01", "lookback_days": 30},
    )
    assert short_response.json()["has_warning"] is False


def test_rotation_check_lookback_days_must_be_positive(client: TestClient) -> None:
    bed_id = _create_bed(client)
    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": "whatever", "lookback_days": 0},
    )
    assert response.status_code == 422


def test_rotation_check_picks_the_most_recent_of_multiple_conflicting_plantings(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    eggplant = _create_plant(db_session, "test-eggplant", "Eggplant", "Solanum melongena", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-01-01",
            "removed_date": "2026-03-01",
        },
    )
    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": eggplant,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-06-01",
            "removed_date": "2026-08-01",
        },
    )

    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": pepper, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_warning"] is True
    # Eggplant (planted 2026-06-01) is more recent than tomato
    # (2026-01-01) - it should win, not just whichever row happened first.
    assert body["conflicting_plant_slug"] == eggplant


def test_rotation_check_as_of_defaults_to_today_when_omitted(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)
    pepper = _create_plant(db_session, "test-pepper", "Pepper", "Capsicum annuum", nightshade_family)

    recently = (date.today() - timedelta(days=10)).isoformat()
    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": recently,
            "removed_date": None,
        },
    )

    # No `as_of` param at all - must default to today, not error or
    # silently use some other date.
    response = client.get(f"/api/beds/{bed_id}/rotation-check", params={"plant_slug": pepper})
    assert response.status_code == 200
    assert response.json()["has_warning"] is True


def test_rotation_check_no_warning_for_same_species(client: TestClient, db_session) -> None:
    bed_id = _create_bed(client)
    nightshade_family = _create_family(db_session, "Solanaceae")
    tomato = _create_plant(db_session, "test-tomato", "Tomato", "Solanum lycopersicum", nightshade_family)

    client.post(
        "/api/plantings",
        json={
            "bed_id": bed_id,
            "plant_slug": tomato,
            "placement_type": "individual",
            "geometry": rectangle(width=20, height=20),
            "planted_date": "2026-04-01",
            "removed_date": "2026-09-01",
        },
    )

    # Same species again isn't a *family*-rotation warning (it's just "the
    # same crop was here"), and check_rotation deliberately excludes it.
    response = client.get(
        f"/api/beds/{bed_id}/rotation-check",
        params={"plant_slug": tomato, "as_of": "2026-10-01"},
    )
    assert response.status_code == 200
    assert response.json()["has_warning"] is False
