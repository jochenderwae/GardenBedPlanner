"""One-off re-run of the growing_information "consolidate" pass (GitHub
issue #120: "Consolidated growing information should always use metric
measurements").

The consolidation pass (etl/growing_info/passes.py's consolidate_pass) had
no unit-conversion instruction, so every already-generated `consolidated`
entry states measurements exactly as the old imperial-only source books
did. Fixed the prompt to require metric-primary units with the original
imperial value in parentheses - but that only affects *future* consolidate
calls, and every plant that has one is already checkpointed done in
etl/growing_info/state.py's plant_pass_done table, so a plain re-run of
`etl.growing_info.run` would skip them all.

This script does the minimal reset needed to make that re-run actually
redo consolidation:
1. For every plant with an existing `consolidated` growing_information
   entry, remove it (the old imperial-only text - raw entries are left
   untouched, they're the permanent audit trail regardless) and reset that
   plant's "consolidate" pass checkpoint.
2. Delegates the actual regeneration to
   etl.growing_info.run.run_passes(None) directly - it already knows how
   to skip everything that's still correctly checkpointed done (extract/
   crosscheck/surface for every plant, and consolidate for anything this
   script didn't touch) and only re-run what was just reset, so this
   doesn't duplicate that logic or waste Ollama calls on unaffected passes.

Run from data/: uv run python -m etl.reconsolidate_growing_info
"""

import json

from etl.config import PLANTS_OUT_DIR
from etl.growing_info import run as growing_info_run
from etl.growing_info import state


def _reset_consolidated_entries() -> int:
    reset_count = 0
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("growing_information", [])
        remaining = [e for e in entries if e.get("record_type") != "consolidated"]
        if len(remaining) == len(entries):
            continue  # no consolidated entry on this plant, nothing to reset

        data["growing_information"] = remaining
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        state.reset_pass_done(data["slug"], "consolidate")
        reset_count += 1
        print(f"[reconsolidate] {data['slug']}: cleared stale consolidated entry, reset consolidate pass")
    return reset_count


def main() -> None:
    state.init_db()
    reset_count = _reset_consolidated_entries()
    print(f"[reconsolidate] reset {reset_count} plant(s); regenerating via run_passes...")
    growing_info_run.run_passes(None)


if __name__ == "__main__":
    main()
