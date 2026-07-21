from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.services.reminders import REMINDER_CHECK_INTERVAL_HOURS, send_due_action_reminders

scheduler = AsyncIOScheduler()


def register_jobs() -> None:
    """Registers every recurring job the scheduler should run - called
    once from main.py's lifespan, before scheduler.start(). Kept here
    (rather than inline in main.py) so main.py doesn't need to know what
    jobs actually exist, matching this module's own job: owning the
    scheduler, not the app."""
    scheduler.add_job(
        send_due_action_reminders,
        "interval",
        hours=REMINDER_CHECK_INTERVAL_HOURS,
        id="due-action-reminders",
        replace_existing=True,
    )
