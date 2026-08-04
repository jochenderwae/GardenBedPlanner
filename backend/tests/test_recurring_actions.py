"""#226: manually-created recurring/repeating tasks - Action.recurrence_*
fields (app/models/action.py) and generation-on-complete/skip
(app/services/recurrence.py, PATCH /api/actions/{id})."""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.models.action import RecurrenceUnit
from app.services.recurrence import shift_date

pytestmark = pytest.mark.integration


def _create_recurring_action(
    client: TestClient,
    *,
    recurrence_unit: str = "weekly",
    recurrence_interval: int = 3,
    recurrence_end_date: str | None = None,
    due_date_start: str = "2027-01-01",
    due_date_end: str = "2027-01-07",
) -> dict:
    payload = {
        "action_type": "compost",
        "due_date_start": due_date_start,
        "due_date_end": due_date_end,
        "recurrence_unit": recurrence_unit,
        "recurrence_interval": recurrence_interval,
    }
    if recurrence_end_date is not None:
        payload["recurrence_end_date"] = recurrence_end_date
    response = client.post("/api/actions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_completing_a_recurring_action_generates_the_next_occurrence(client: TestClient) -> None:
    """Ticket step 1+2: every 3 weeks, no plant_slug/garden_plan_entry_id
    (a bed-level chore) - marking it completed generates the next
    occurrence shifted 3 weeks forward, pending, linked back via
    recurrence_source_action_id, with the same recurrence settings."""
    action = _create_recurring_action(client)

    complete_response = client.patch(f"/api/actions/{action['id']}", json={"status": "completed"})
    assert complete_response.status_code == 200, complete_response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action["id"]]
    assert len(generated) == 1
    next_occurrence = generated[0]
    assert next_occurrence["status"] == "pending"
    assert next_occurrence["due_date_start"] == "2027-01-22"  # 2027-01-01 + 3 weeks
    assert next_occurrence["due_date_end"] == "2027-01-28"  # 2027-01-07 + 3 weeks
    assert next_occurrence["recurrence_unit"] == "weekly"
    assert next_occurrence["recurrence_interval"] == 3


def test_skipping_a_recurring_action_still_generates_the_next_occurrence(client: TestClient) -> None:
    """Ticket step 3: a skipped chore isn't a cancelled recurrence."""
    action = _create_recurring_action(client)

    skip_response = client.patch(f"/api/actions/{action['id']}", json={"status": "skipped"})
    assert skip_response.status_code == 200, skip_response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action["id"]]
    assert len(generated) == 1
    assert generated[0]["status"] == "pending"


def test_recurrence_end_date_before_next_occurrence_stops_generation(client: TestClient) -> None:
    """Ticket step 4: recurrence_end_date set to a date before the next
    computed occurrence's due window - no further occurrence generates."""
    action = _create_recurring_action(
        client,
        recurrence_end_date="2027-01-10",  # before 2027-01-22/2027-01-28
    )

    response = client.patch(f"/api/actions/{action['id']}", json={"status": "completed"})
    assert response.status_code == 200, response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action["id"]]
    assert generated == []


def test_recurrence_end_date_after_next_occurrence_still_generates(client: TestClient) -> None:
    action = _create_recurring_action(
        client,
        recurrence_end_date="2027-06-01",  # well after 2027-01-22/2027-01-28
    )

    response = client.patch(f"/api/actions/{action['id']}", json={"status": "completed"})
    assert response.status_code == 200, response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action["id"]]
    assert len(generated) == 1


def test_completing_a_non_recurring_action_generates_nothing(client: TestClient) -> None:
    """Ticket step 5: no regression for the existing (non-recurring) case."""
    action_id = client.post(
        "/api/actions",
        json={"action_type": "harvest", "due_date_end": "2027-07-01"},
    ).json()["id"]

    response = client.patch(f"/api/actions/{action_id}", json={"status": "completed"})
    assert response.status_code == 200, response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action_id]
    assert generated == []


def test_redundant_patch_on_an_already_completed_action_does_not_duplicate(client: TestClient) -> None:
    """Gated on the *transition* into a terminal status, not just "is
    currently terminal" - re-saving an already-completed recurring action
    (e.g. a client retry) must not generate a second occurrence."""
    action = _create_recurring_action(client)

    first = client.patch(f"/api/actions/{action['id']}", json={"status": "completed"})
    assert first.status_code == 200

    second = client.patch(f"/api/actions/{action['id']}", json={"status": "completed", "notes": "retry"})
    assert second.status_code == 200

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action["id"]]
    assert len(generated) == 1


def test_recurring_action_with_no_due_dates_generates_a_next_occurrence_with_no_due_dates(
    client: TestClient,
) -> None:
    """A recurring chore with no due-date window at all is still a valid
    corner case - generation shouldn't crash, and the generated occurrence
    just carries no due dates forward either."""
    action_id = client.post(
        "/api/actions",
        json={"action_type": "compost", "recurrence_unit": "monthly", "recurrence_interval": 1},
    ).json()["id"]

    response = client.patch(f"/api/actions/{action_id}", json={"status": "completed"})
    assert response.status_code == 200, response.text

    all_actions = client.get("/api/actions").json()
    generated = [a for a in all_actions if a["recurrence_source_action_id"] == action_id]
    assert len(generated) == 1
    assert generated[0]["due_date_start"] is None
    assert generated[0]["due_date_end"] is None


class TestShiftDate:
    def test_daily(self) -> None:
        assert shift_date(date(2027, 1, 1), RecurrenceUnit.daily, 5) == date(2027, 1, 6)

    def test_weekly(self) -> None:
        assert shift_date(date(2027, 1, 1), RecurrenceUnit.weekly, 3) == date(2027, 1, 22)

    def test_monthly(self) -> None:
        assert shift_date(date(2027, 1, 15), RecurrenceUnit.monthly, 2) == date(2027, 3, 15)

    def test_monthly_clamps_at_month_end(self) -> None:
        """Jan 31 + 1 month -> Feb 28 (2027 isn't a leap year), not an
        invalid Feb 31 date or a rollover into March."""
        assert shift_date(date(2027, 1, 31), RecurrenceUnit.monthly, 1) == date(2027, 2, 28)

    def test_monthly_rolls_over_the_year_boundary(self) -> None:
        assert shift_date(date(2027, 11, 15), RecurrenceUnit.monthly, 3) == date(2028, 2, 15)

    def test_yearly(self) -> None:
        assert shift_date(date(2027, 3, 1), RecurrenceUnit.yearly, 2) == date(2029, 3, 1)

    def test_yearly_leap_day_clamps_on_a_non_leap_target_year(self) -> None:
        assert shift_date(date(2028, 2, 29), RecurrenceUnit.yearly, 1) == date(2029, 2, 28)
