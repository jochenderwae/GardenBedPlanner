"""One-off task: normalize `edible_parts` to a closed canonical category
list and backfill it where missing. Backlog issue #133.

Before this task, `edible_parts` was documented as "open-ended, not a
closed enum" and, in practice, wildly inconsistent: a full audit of the 150
(of 359) plants that had it populated at all (2026-07-22) found 34 distinct
raw string values for what are really about 10 underlying concepts -
singular/plural spelling drift ('fruit' vs 'fruits', 'root' vs 'roots',
'bulb' vs 'bulbs', 'stem' vs 'stems', 'tuber' vs 'tubers'), synonyms
('stalks'/'leaf stems'/'midrib' all really meaning a stem-like part,
'onions'/'shallot' meaning a bulb), and a few genuinely ambiguous values
that need per-plant judgment rather than a blind string substitution
('heads' means a leaf-cluster for cabbage but a flower-cluster for
broccoli/cauliflower; 'hops' - the plant's own name copied verbatim - really
means the cone, itself a flower-bract cluster).

Final canonical list (see plant.schema.json's own field description for the
full definitions): fruit, leaves, roots, tubers, bulbs, stems, seeds,
flowers, pods, shoots. Chosen to (a) cover every real value seen in the
existing 150-plant audit without inventing categories nothing needs, and
(b) keep roots/tubers/bulbs distinct rather than merging (a plant like
cassava genuinely has both a root a gardener eats and a tuber a gardener
eats - collapsing them would lose real information a small number of plants
actually need).

Two passes, both source-tagged in data_sources so a reader can tell which
happened:

1. **Normalize** every already-populated edible_parts array via
   _NORMALIZE_MAP (deterministic - no LLM involved, since every raw value
   was hand-audited against real data before writing this map) plus a small
   per-slug override table for the genuinely ambiguous cases above. Any raw
   value NOT covered by the map or an override (shouldn't happen given the
   audit, but the map is a static lookup, not a moving target) is left
   untouched and logged to edible_parts_normalization_gaps.jsonl rather than
   silently dropped or guessed.
2. **Backfill** edible_parts for plants missing it via Ollama
   (etl.ollama_resolve.infer_edible_parts), informed by
   description/growing_information text. Deliberately does NOT gate on this
   plant's own recorded is_edible field - see infer_edible_parts's own
   docstring for why (a live audit found 25 plants with edible_parts already
   populated that are ALSO marked is_edible=false, so that field can't be
   trusted as a filter; flagged separately in suggestions.md, out of this
   issue's scope to fix). Plants Ollama judges not edible (or isn't
   confident about) are logged to edible_parts_unmatched.jsonl and left
   without the field - expected to be the common case, not a failure, since
   most of the ~359 plants in this database are not food crops.

Concurrency note: same re-read-fresh-before-write + hot-file-skip mitigation
as populate_growth_habit.py/populate_life_cycle.py, in case another process
is mid-write on data/plants/*.json when this runs - see
populate_growth_habit.py's module docstring for the full reasoning.

Run from data/: uv run python -m etl.populate_edible_parts
"""

import json
import time
from pathlib import Path

import jsonschema

from etl.config import DATA_DIR, PLANT_SCHEMA_PATH, PLANTS_OUT_DIR
from etl.ollama_resolve import infer_edible_parts

NORMALIZATION_GAPS_LOG = DATA_DIR / "edible_parts_normalization_gaps.jsonl"
UNMATCHED_LOG = DATA_DIR / "edible_parts_unmatched.jsonl"
_HOT_FILE_SKIP_SECONDS = 5

_CANONICAL_ORDER = [
    "fruit", "leaves", "roots", "tubers", "bulbs", "stems", "seeds", "flowers", "pods", "shoots",
]

# Deterministic raw-value -> canonical mapping, built from a full audit of
# every distinct raw edible_parts value actually present in data/plants/
# before this task ran (2026-07-22) - not a general-purpose guess table.
_NORMALIZE_MAP = {
    "fruit": "fruit",
    "fruits": "fruit",
    "root": "roots",
    "roots": "roots",
    "tuber": "tubers",
    "tubers": "tubers",
    "leaves": "leaves",
    "seeds": "seeds",
    "pods": "pods",
    "bulb": "bulbs",
    "bulbs": "bulbs",
    "stem": "stems",
    "stems": "stems",
    "flowers": "flowers",
    "stalks": "stems",
    "onions": "bulbs",
    "midrib": "stems",
    "curds": "flowers",
    "shallot": "bulbs",
    "leaf stems": "stems",
    "flower buds": "flowers",
    "shoots": "shoots",
    "young leaves": "leaves",
    "soft bulbs": "bulbs",
    "thick leaves": "leaves",
    "hops": "flowers",
}

# Per-slug overrides for values whose real meaning depends on the plant, not
# just the string itself - checked before the generic map above.
_SLUG_OVERRIDES = {
    "cabbage": {"heads": "leaves"},  # cabbage's "head" is a tight leaf cluster, not a flower structure
    "broccoli": {"heads": "flowers"},  # broccoli's "head" is an immature flower cluster
    "purple-cauliflower": {"heads": "flowers"},  # same as broccoli
    # Leek does not form a true bulb (confirmed by leek's own
    # growing_information text: "leeks do not form a true bulb...but
    # develop a uniformly thick stem") - override the generic "soft
    # bulbs" -> "bulbs" mapping for this one plant.
    "leek": {"soft bulbs": "stems"},
}

with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
    _SCHEMA = json.load(f)


def _normalize_value(slug: str, raw: str) -> str | None:
    """Returns the canonical value for one raw edible_parts entry, or None
    if this raw value isn't covered by the override table or the generic
    map (should not happen given the audit this map was built from)."""
    lower = raw.strip().lower()
    override = _SLUG_OVERRIDES.get(slug, {})
    if lower in override:
        return override[lower]
    return _NORMALIZE_MAP.get(lower)


def _growing_info_excerpt(data: dict) -> str | None:
    entries = data.get("growing_information") or []
    consolidated = next((e for e in entries if e.get("record_type") == "consolidated"), None)
    entry = consolidated or (entries[0] if entries else None)
    if not entry:
        return None
    return entry.get("text", "")[:600] or None


def _log_normalization_gap(slug: str, raw_values: list[str], reasoning: str) -> None:
    entry = {"slug": slug, "raw_values": raw_values, "reasoning": reasoning}
    with open(NORMALIZATION_GAPS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[edible-parts] {slug}: NORMALIZATION GAP - {reasoning}")


def _log_unmatched(slug: str, reasoning: str) -> None:
    entry = {"slug": slug, "reasoning": reasoning}
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[edible-parts] {slug}: UNMATCHED - {reasoning}")


def _process(path: Path) -> str:
    """Returns one of: 'skipped-hot', 'normalized', 'unchanged',
    'backfilled', 'unmatched', 'normalization-gap'."""
    if time.time() - path.stat().st_mtime < _HOT_FILE_SKIP_SECONDS:
        return "skipped-hot"

    data = json.loads(path.read_text(encoding="utf-8"))
    slug = data["slug"]
    raw_parts = data.get("edible_parts")

    if raw_parts:
        canonical: list[str] = []
        gaps: list[str] = []
        for raw in raw_parts:
            normalized = _normalize_value(slug, raw)
            if normalized is None:
                gaps.append(raw)
            elif normalized not in canonical:
                canonical.append(normalized)

        if gaps:
            _log_normalization_gap(
                slug, raw_parts,
                f"raw value(s) {gaps!r} not covered by _NORMALIZE_MAP/_SLUG_OVERRIDES - left unchanged",
            )
            return "normalization-gap"

        canonical = [v for v in _CANONICAL_ORDER if v in canonical]
        if canonical == raw_parts:
            return "unchanged"

        fresh = json.loads(path.read_text(encoding="utf-8"))
        if fresh.get("edible_parts") != raw_parts:
            return "unchanged"  # someone else changed it between our read and now
        fresh["edible_parts"] = canonical
        fresh.setdefault("data_sources", []).append(
            {
                "attribution": "manual-edible-parts-normalization",
                "notes": (
                    f"edible_parts normalized from {raw_parts!r} to {canonical!r} - closed "
                    "category list defined for backlog #133 (see plant.schema.json's "
                    "edible_parts description)"
                ),
            }
        )
        jsonschema.validate(fresh, _SCHEMA)
        path.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[edible-parts] {slug}: normalized {raw_parts} -> {canonical}")
        return "normalized"

    # Missing entirely - backfill via Ollama.
    resolved, reasoning = infer_edible_parts(
        slug=slug,
        common_name=data.get("common_name", slug),
        botanical_name=data.get("botanical_name"),
        description=data.get("description"),
        growing_info_excerpt=_growing_info_excerpt(data),
    )
    if resolved is None:
        _log_unmatched(slug, reasoning)
        return "unmatched"

    fresh = json.loads(path.read_text(encoding="utf-8"))
    if fresh.get("edible_parts"):
        return "unchanged"  # someone else set it between our read and now
    fresh["edible_parts"] = resolved
    fresh.setdefault("data_sources", []).append(
        {
            "attribution": "ollama-edible-parts-inference",
            "notes": f"edible_parts={resolved!r} inferred by Ollama; reasoning: {reasoning}",
        }
    )
    jsonschema.validate(fresh, _SCHEMA)
    path.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[edible-parts] {slug}: backfilled {resolved}")
    return "backfilled"


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
        print(f"[edible-parts] {path.stem}: still hot after retries, leaving for a future run")

    print(f"[edible-parts] done: {counts}")


if __name__ == "__main__":
    main()
