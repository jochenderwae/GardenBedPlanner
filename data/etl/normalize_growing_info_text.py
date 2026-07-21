"""One-off cleanup pass for growing_information paragraph layout (GitHub
issue #119: "Growing information text layout is inconsistent").

The growing-information ingestion run (data/CLAUDE.md's growing_information
section) already completed in full before this bug was found and fixed in
etl/growing_info/split.py (see that module's docstring, and
etl/growing_info/text_normalize.py for the actual reflow logic) - so every
`raw` growing_information entry already stored in data/plants/*.json still
has the old, buggy layout (embedded mid-sentence \r\n line-wraps and/or
mid-sentence \n\n from a per-line-tagged source book) baked into its `text`.
Re-running ingestion wouldn't fix these in place: state.py has every section
already marked done, and storage.add_growing_info_entry dedupes on the
existing (source_url, text) pair, so it would just skip them again.

This script re-normalizes every already-stored `raw` entry's `text` in
place via reflow_stored_text - same fix, applied retroactively. `text_type: consolidated`
entries are untouched: a scan of all 123 existing consolidated entries found
none with an embedded \r and none with a mid-sentence \n (the Ollama
consolidation prompt already produces clean prose; the handful with a real
`\n\n` all landed at a genuine sentence/paragraph boundary) - nothing to fix
there, and touching Ollama-authored text without a schema difference isn't
this task's job (issue #119 is purely a layout bug, not a synthesis-quality
one). If the raw-entry cleanup ever changes what a future consolidation
pass would produce, `growing_info.run --skip-ingestion` (with state.py's
per-plant "consolidate" pass reset) is the way to re-derive `consolidated`
entries from cleaner raw text - not attempted here, out of this task's
scope.

Run from data/: uv run python -m etl.normalize_growing_info_text
"""

import json

from etl.config import PLANTS_OUT_DIR
from etl.export import validate
from etl.growing_info.text_normalize import reflow_stored_text


def main() -> None:
    changed_plants = 0
    changed_entries = 0
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("growing_information", [])
        if not entries:
            continue

        plant_changed = False
        for entry in entries:
            if entry.get("record_type", "raw") != "raw":
                continue
            original = entry.get("text", "")
            cleaned = reflow_stored_text(original)
            if cleaned != original:
                entry["text"] = cleaned
                plant_changed = True
                changed_entries += 1

        if plant_changed:
            validate(data)
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            changed_plants += 1
            print(f"[normalize-growing-info] {data['slug']}: reflowed raw growing_information text")

    print(f"[normalize-growing-info] done: {changed_entries} entries across {changed_plants} plant(s) updated")


if __name__ == "__main__":
    main()
