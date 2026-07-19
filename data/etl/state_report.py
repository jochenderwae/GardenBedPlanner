"""Prints progress summaries for both ETL state databases (the main
pipeline's progress.db and growing_info's own growing_info.db) - the
recurring ad-hoc check that kept getting re-run by hand as inline
`python -c "..."` one-liners. Promoted to a real, reusable module instead.

Run with: uv run python -m etl.state_report (from data/), or via
claudeTools/data_run_module.ps1 etl.state_report from the repo root.
"""

import sqlite3

from etl.config import STATE_DB as MAIN_STATE_DB
from etl.growing_info.state import STATE_DB as GROWING_INFO_STATE_DB


def _print_main_etl_progress() -> None:
    print(f"[main etl] {MAIN_STATE_DB}")
    if not MAIN_STATE_DB.exists():
        print("  no state db yet")
        return
    conn = sqlite3.connect(str(MAIN_STATE_DB))
    total = conn.execute("SELECT COUNT(*) FROM plant_progress").fetchone()[0]
    print(f"  total plants tracked: {total}")
    for stage, count in conn.execute(
        "SELECT stage, COUNT(*) FROM plant_progress GROUP BY stage"
    ).fetchall():
        print(f"  {stage}: {count}")


def _print_growing_info_progress() -> None:
    print(f"[growing_info] {GROWING_INFO_STATE_DB}")
    if not GROWING_INFO_STATE_DB.exists():
        print("  no state db yet")
        return
    conn = sqlite3.connect(str(GROWING_INFO_STATE_DB))
    sections = conn.execute("SELECT COUNT(*) FROM section_done").fetchone()[0]
    plants_with_any_pass = conn.execute(
        "SELECT COUNT(DISTINCT slug) FROM plant_pass_done"
    ).fetchone()[0]
    print(f"  sections checkpointed: {sections}")
    print(f"  plants with at least one pass done: {plants_with_any_pass}")
    for pass_name, count in conn.execute(
        "SELECT pass_name, COUNT(*) FROM plant_pass_done GROUP BY pass_name"
    ).fetchall():
        print(f"  {pass_name}: {count}")


def main() -> None:
    _print_main_etl_progress()
    print()
    _print_growing_info_progress()


if __name__ == "__main__":
    main()
