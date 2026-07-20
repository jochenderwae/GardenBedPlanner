"""One-off task: populate `life_cycle` (annual/biennial/perennial) and,
where genuinely well-known, `life_cycle_years` (a perennial's typical
productive lifespan before customary renewal, e.g. ~7 for raspberry canes) -
see plant.schema.json's field descriptions. Backlog issue #60.

No structured source in this pipeline has this data at all. Checked before
writing this script (2026-07-20): Trefle's top-level `main_species.duration`
key - the obvious candidate - is `null` in every one of the 298 cached
responses under data/.cache/trefle/ that have a main_species at all (a full
scan, not a spot check); its `growth`/`specifications` sub-objects (already
mined for growth_habit - see populate_growth_habit.py and data/CLAUDE.md's
correction note) have no duration-type field either. So unlike
populate_growth_habit.py, there's no deterministic-from-a-structured-source
path here at all - every plant goes through Ollama, informed by whatever
`description`/`growing_information` text is available (per the backlog
issue's own instruction to check both), same shape as
ollama_resolve.infer_botanical_name's "no source had one" case.

life_cycle_years is only attempted for plants Ollama placed as "perennial" -
schema-wise it's meaningless for annual/biennial - and even then only
written when Ollama confidently names a specific, well-known figure (see
infer_life_cycle_years's docstring); most perennials correctly stay null.

Every populated value is source-tagged in data_sources
("ollama-life-cycle-inference" / "ollama-life-cycle-years-inference") so
it's clearly distinguishable as an inference, not a structured-source fact -
same convention growth_habit/botanical_name inference already established.
Plants Ollama declines to categorize confidently are logged to
life_cycle_unmatched.jsonl and left without the field (schema-optional)
rather than guessed.

Concurrency note: same re-read-fresh-before-write + hot-file-skip mitigation
as populate_growth_habit.py, in case another process is mid-write on
data/plants/*.json when this runs - see that module's docstring for the
full reasoning (kept here for consistency even though no other write pass
was found running when this script was first run).

Run from data/: uv run python -m etl.populate_life_cycle
"""

import json
import time
from pathlib import Path

import jsonschema

from etl.config import DATA_DIR, PLANT_SCHEMA_PATH, PLANTS_OUT_DIR
from etl.ollama_resolve import infer_life_cycle, infer_life_cycle_years

UNMATCHED_LOG = DATA_DIR / "life_cycle_unmatched.jsonl"
_HOT_FILE_SKIP_SECONDS = 5

with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
    _SCHEMA = json.load(f)


def _growing_info_excerpt(data: dict) -> str | None:
    """Same approach as populate_growth_habit.py's helper, but prefers an
    excerpt that actually mentions a life-cycle-relevant word when one
    exists among this plant's growing_information entries, since the
    consolidated entry (or first raw entry) picked blindly might not
    happen to discuss life cycle at all within its first 600 characters."""
    entries = data.get("growing_information") or []
    if not entries:
        return None

    keywords = ("annual", "biennial", "perennial", "reseed", "self-sow", "overwinter")
    for entry in entries:
        text = entry.get("text", "")
        lower = text.lower()
        if any(k in lower for k in keywords):
            # Center the excerpt on the first keyword hit rather than
            # always the start of the text, so the relevant sentence
            # actually survives the character cap.
            idx = min((lower.find(k) for k in keywords if k in lower))
            start = max(0, idx - 200)
            return text[start : start + 600]

    consolidated = next((e for e in entries if e.get("record_type") == "consolidated"), None)
    entry = consolidated or entries[0]
    return entry.get("text", "")[:600] or None


def _log_unmatched(slug: str, field: str, reasoning: str) -> None:
    entry = {"slug": slug, "field": field, "reasoning": reasoning}
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[life-cycle] {slug}: UNMATCHED ({field}) - {reasoning}")


def _process(path: Path) -> str:
    """Returns one of: 'skipped-hot', 'already-set', 'set', 'unmatched'."""
    if time.time() - path.stat().st_mtime < _HOT_FILE_SKIP_SECONDS:
        return "skipped-hot"

    data = json.loads(path.read_text(encoding="utf-8"))
    if "life_cycle" in data:
        return "already-set"

    slug = data["slug"]
    common_name = data.get("common_name", slug)
    botanical_name = data.get("botanical_name")
    family = data.get("family")
    description = data.get("description")
    gi_excerpt = _growing_info_excerpt(data)

    life_cycle, lc_reasoning = infer_life_cycle(
        slug=slug,
        common_name=common_name,
        botanical_name=botanical_name,
        family=family,
        description=description,
        growing_info_excerpt=gi_excerpt,
    )

    if life_cycle is None:
        _log_unmatched(slug, "life_cycle", lc_reasoning)
        return "unmatched"

    source_notes = [
        {
            "attribution": "ollama-life-cycle-inference",
            "notes": f"life_cycle={life_cycle!r} inferred by Ollama; reasoning: {lc_reasoning}",
        }
    ]

    life_cycle_years: int | None = None
    if life_cycle == "perennial":
        life_cycle_years, years_reasoning = infer_life_cycle_years(
            slug=slug,
            common_name=common_name,
            botanical_name=botanical_name,
            description=description,
            growing_info_excerpt=gi_excerpt,
        )
        if life_cycle_years is not None:
            source_notes.append(
                {
                    "attribution": "ollama-life-cycle-years-inference",
                    "notes": (
                        f"life_cycle_years={life_cycle_years!r} inferred by Ollama; "
                        f"reasoning: {years_reasoning}"
                    ),
                }
            )
        # A null life_cycle_years here is the expected, common outcome (most
        # perennials have no customary renewal interval) - not logged to
        # unmatched, since it's not a failure, just "no answer per the
        # design of the field itself".

    # Re-read fresh right before writing - see module docstring's
    # concurrency note.
    fresh = json.loads(path.read_text(encoding="utf-8"))
    if "life_cycle" in fresh:
        return "already-set"  # someone else set it between our read and now
    fresh["life_cycle"] = life_cycle
    if life_cycle_years is not None:
        fresh["life_cycle_years"] = life_cycle_years
    fresh.setdefault("data_sources", []).extend(source_notes)
    jsonschema.validate(fresh, _SCHEMA)
    path.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[life-cycle] {slug}: life_cycle={life_cycle} life_cycle_years={life_cycle_years}")
    return "set"


def main() -> None:
    files = sorted(PLANTS_OUT_DIR.glob("*.json"))
    counts: dict[str, int] = {}
    retry: list[Path] = []
    for path in files:
        outcome = _process(path)
        counts[outcome] = counts.get(outcome, 0) + 1
        if outcome == "skipped-hot":
            retry.append(path)

    attempts = 0
    while retry and attempts < 3:
        attempts += 1
        time.sleep(_HOT_FILE_SKIP_SECONDS)
        still_hot = []
        for path in retry:
            outcome = _process(path)
            if outcome == "skipped-hot":
                still_hot.append(path)
            else:
                counts[outcome] = counts.get(outcome, 0) + 1
                counts["skipped-hot"] -= 1
        retry = still_hot
    for path in retry:
        print(f"[life-cycle] {path.stem}: still hot after retries, leaving for a future run")

    print(f"[life-cycle] done: {counts}")


if __name__ == "__main__":
    main()
