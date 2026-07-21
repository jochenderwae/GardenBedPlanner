"""Crash/interruption recovery for the growing_information pipeline - same
SQLite-with-immediate-commit pattern as etl/state.py, but a genuinely
separate database and table set, NOT an extension of etl/state.py's
plant_progress table. That table's "master"/"enriched"/"exported" stages are
specific to the main pipeline's per-plant unit of work; this pipeline has
two different units of work instead: one row per (book, section) during
ingestion, one row per (plant, pass) during the four post-processing passes.

Section checkpointing is deliberately single-shot (one row written only once
a section is FULLY handled - classified, matched, and stored if applicable),
not staged sub-steps: same reasoning etl/state.py's own docstring gives for
why merge/resolve aren't separate checkpoints there - classify+match+store
for one section is a handful of fast Ollama calls, cheap enough that redoing
all of them for whichever ONE section was mid-flight during a crash is an
acceptable cost, and far simpler than resuming mid-section correctly.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from etl.config import DATA_DIR

STATE_DB = DATA_DIR / ".state" / "growing_info.db"
STATE_DB.parent.mkdir(parents=True, exist_ok=True)

PASS_NAMES = ["consolidate", "extract", "crosscheck", "surface"]


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
            """CREATE TABLE IF NOT EXISTS section_done (
                section_id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                matched_slugs TEXT NOT NULL,
                done_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS plant_pass_done (
                slug TEXT NOT NULL,
                pass_name TEXT NOT NULL,
                done_at TEXT NOT NULL,
                PRIMARY KEY (slug, pass_name)
            )"""
        )
        conn.commit()


def is_section_done(section_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM section_done WHERE section_id = ?", (section_id,)
        ).fetchone()
        return row is not None


def mark_section_done(section_id: str, book_id: str, matched_slugs: list[str]) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO section_done (section_id, book_id, matched_slugs, done_at) VALUES (?, ?, ?, ?)",
            (section_id, book_id, json.dumps(matched_slugs), _now()),
        )
        conn.commit()


def is_pass_done(slug: str, pass_name: str) -> bool:
    assert pass_name in PASS_NAMES, f"unknown pass {pass_name!r}"
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM plant_pass_done WHERE slug = ? AND pass_name = ?", (slug, pass_name)
        ).fetchone()
        return row is not None


def mark_pass_done(slug: str, pass_name: str) -> None:
    assert pass_name in PASS_NAMES, f"unknown pass {pass_name!r}"
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO plant_pass_done (slug, pass_name, done_at) VALUES (?, ?, ?)",
            (slug, pass_name, _now()),
        )
        conn.commit()


def reset_pass_done(slug: str, pass_name: str) -> None:
    """Un-checkpoints one plant/pass so run_passes redoes it on the next
    invocation - used when a pass's own logic changes (e.g. issue #120's
    metric-units prompt fix) and already-processed plants need to go
    through it again, without re-running the other 3 passes (still
    correctly marked done) or the whole ingestion phase."""
    assert pass_name in PASS_NAMES, f"unknown pass {pass_name!r}"
    with _connect() as conn:
        conn.execute(
            "DELETE FROM plant_pass_done WHERE slug = ? AND pass_name = ?", (slug, pass_name)
        )
        conn.commit()
