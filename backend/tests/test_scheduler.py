"""app/core/scheduler.py's register_jobs() (#48) - the implementer's own
outcome comment notes this was only smoke-checked manually via a `python
-c` one-liner, not through the pytest suite. Every other test in this file
already exercises register_jobs() indirectly (the `client` fixture's
`with TestClient(app) as ...` triggers main.py's lifespan, which calls it
and starts/stops the scheduler on every single test that uses `client`),
but nothing asserts the job it adds actually has the right id/interval -
this fills that gap directly."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.scheduler import REMINDER_CHECK_INTERVAL_HOURS, register_jobs, scheduler
from app.main import app

pytestmark = pytest.mark.integration


def test_register_jobs_adds_the_due_action_reminders_interval_job() -> None:
    register_jobs()
    job = scheduler.get_job("due-action-reminders")
    assert job is not None
    assert job.trigger.interval == timedelta(hours=REMINDER_CHECK_INTERVAL_HOURS)


def test_repeated_app_lifespans_do_not_accumulate_duplicate_jobs() -> None:
    """The realistic scenario - main.py's lifespan calls register_jobs()
    exactly once per app startup, immediately followed by scheduler.start()
    (which flushes any pending job additions into the real jobstore,
    deduping by id via replace_existing=True) and, on shutdown,
    AsyncIOScheduler's default MemoryJobStore wipes itself clean
    (jobstore.shutdown() -> remove_all_jobs()) - so every real
    startup/shutdown cycle starts from an empty jobstore and ends with
    exactly one "due-action-reminders" job. This is exactly what happens
    across this whole test suite already (dozens of other tests each enter
    and exit their own `with TestClient(app)` lifespan via the `client`
    fixture) - explicitly driving two full cycles back-to-back here proves
    it directly rather than relying on that being incidentally true
    elsewhere.

    Deliberately *not* testing "register_jobs() called twice with no
    scheduler.start() in between" - APScheduler's replace_existing only
    dedupes against jobs already flushed into the real jobstore, so two
    raw add_job() calls before the first start() genuinely do produce
    duplicates, but that sequence never actually happens in this codebase
    (register_jobs() has exactly one call site, immediately followed by
    scheduler.start()) - a test asserting on it would be testing an
    unreachable code path, not real behavior."""
    with TestClient(app):
        pass
    with TestClient(app):
        jobs = [j for j in scheduler.get_jobs() if j.id == "due-action-reminders"]
        assert len(jobs) == 1
