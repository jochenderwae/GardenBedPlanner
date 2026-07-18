"""Crash/interruption recovery (requirement 6).

SQLite because it's stdlib, gives us durable commits (survives a hard
crash/hibernation mid-write, unlike a plain JSON file rewritten in place),
and lets us query progress without loading everything into memory. Every
write commits immediately - we'd rather do a tiny bit of redundant I/O than
lose track of where we were.
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from etl.config import STATE_DB

# Stage order for a single plant, each strictly after the last. Merge and
# Ollama-resolve aren't separate checkpoints - they're fast/cheap enough
# (compared to network fetches) that redoing both for whichever one plant
# was mid-flight when a crash/hibernation hit is acceptable; only "enriched"
# (all source data collected) and "exported" (final JSON written+validated)
# are meaningfully worth persisting.
STAGES = ["master", "enriched", "exported"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _connect():
    conn = sqlite3.connect(STATE_DB, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS plant_progress (
                slug TEXT PRIMARY KEY,
                stage TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS bulk_source_fetched (
                source TEXT PRIMARY KEY,
                fetched_at TEXT NOT NULL
            )"""
        )
        conn.commit()


def mark_bulk_source_fetched(source: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO bulk_source_fetched (source, fetched_at) VALUES (?, ?)",
            (source, _now()),
        )
        conn.commit()


def is_bulk_source_fetched(source: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM bulk_source_fetched WHERE source = ?", (source,)
        ).fetchone()
        return row is not None


def get_stage(slug: str) -> str | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT stage FROM plant_progress WHERE slug = ?", (slug,)
        ).fetchone()
        return row[0] if row else None


def set_stage(slug: str, stage: str) -> None:
    """Monotonic: never regresses a plant to an earlier stage than it's
    already reached. Without this, calling build_master_list() again
    (e.g. for standalone debugging/inspection, as happened once for
    real) silently resets every plant back to "master", discarding
    already-recorded "enriched"/"exported" progress even though the
    actual output files on disk are untouched - a resumability footgun
    worth guarding against unconditionally, not just at call sites."""
    assert stage in STAGES, f"unknown stage {stage!r}"
    if stage_reached(slug, stage):
        return
    with _connect() as conn:
        conn.execute(
            "INSERT INTO plant_progress (slug, stage, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(slug) DO UPDATE SET stage=excluded.stage, updated_at=excluded.updated_at",
            (slug, stage, _now()),
        )
        conn.commit()


def stage_reached(slug: str, stage: str) -> bool:
    """True if this plant is at `stage` or any later stage - i.e. this
    stage's work is already done and can be skipped on resume."""
    current = get_stage(slug)
    if current is None:
        return False
    return STAGES.index(current) >= STAGES.index(stage)


def all_slugs_at_or_past(stage: str) -> set[str]:
    with _connect() as conn:
        rows = conn.execute("SELECT slug, stage FROM plant_progress").fetchall()
    target_idx = STAGES.index(stage)
    return {slug for slug, stage_val in rows if STAGES.index(stage_val) >= target_idx}


def progress_summary() -> dict[str, int]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT stage, COUNT(*) FROM plant_progress GROUP BY stage"
        ).fetchall()
    return dict(rows)
