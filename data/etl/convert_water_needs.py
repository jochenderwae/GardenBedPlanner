"""Converts the free-text `water_needs` field ("~1.0 in/week") on every
data/plants/<slug>.json into a numeric `water_needs_mm_per_week` field, per
GitHub issue #137 (sibling of #138 backend/#139 frontend, both children of
tracking issue #126). Unit decision (mm/week, not L/week) is documented on
#126 itself.

All ~60 populated values follow the same "~N(.N) in/week" pattern (verified
by inspection before writing this), so this is a straight regex parse +
x25.4 conversion, rounded to 1 decimal - no Ollama/LLM pass needed. Anything
that doesn't match the expected pattern is logged rather than guessed at
(same convention as every other ETL script here - see growing_info_unmatched
.jsonl etc.).

Deliberately a separate entrypoint, not wired into etl.run: it operates on
already-exported data/plants/*.json, same reasoning backfill_taxonomy.py
documents for being separate.

Run from data/: uv run python -m etl.convert_water_needs
"""

import json
import re

import jsonschema

from etl.config import DATA_DIR, PLANT_SCHEMA_PATH, PLANTS_OUT_DIR

UNMATCHED_LOG = DATA_DIR / "water_needs_conversion_unmatched.jsonl"

_IN_PER_WEEK_RE = re.compile(r"^~?\s*(\d+(?:\.\d+)?)\s*in/week$")
_INCH_TO_MM = 25.4

with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
    _SCHEMA = json.load(f)


def _log_unmatched(slug: str, raw_value: str, reason: str) -> None:
    entry = {"slug": slug, "raw_value": raw_value, "reason": reason}
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def parse_in_per_week(raw_value: str) -> float | None:
    match = _IN_PER_WEEK_RE.match(raw_value.strip())
    if not match:
        return None
    inches = float(match.group(1))
    return round(inches * _INCH_TO_MM, 1)


def main() -> None:
    files = sorted(PLANTS_OUT_DIR.glob("*.json"))
    converted, skipped = 0, 0
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        raw_value = data.get("water_needs")
        if raw_value is None:
            continue

        if not isinstance(raw_value, str):
            _log_unmatched(data["slug"], repr(raw_value), "not a string")
            skipped += 1
            continue

        mm_per_week = parse_in_per_week(raw_value)
        if mm_per_week is None:
            _log_unmatched(data["slug"], raw_value, "did not match '~N in/week' pattern")
            skipped += 1
            continue

        del data["water_needs"]
        data["water_needs_mm_per_week"] = mm_per_week
        jsonschema.validate(data, _SCHEMA)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        converted += 1
        print(f"[water-needs] {data['slug']}: {raw_value!r} -> {mm_per_week} mm/week")

    print(
        f"[water-needs] done: {converted} converted, {skipped} skipped/unmatched "
        f"(see {UNMATCHED_LOG})"
    )


if __name__ == "__main__":
    main()
