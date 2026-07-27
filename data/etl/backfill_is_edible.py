"""One-off backfill for GitHub issue #165: `is_edible: false` on plants that
already have `edible_parts` populated - a real contradiction (if a source or
an Ollama inference pass positively identified an edible part, the plant is
by definition edible), not just an inconsistency to leave alone. Confirmed
via a full-dataset audit (see this module's own `find_contradictions`) that
every one of these has `is_toxic` unset too, i.e. nothing in the data itself
explains the `false` - this reads as a genuine `is_edible` data-quality bug
from the original ETL run/merge, not a deliberate "edible part, but still
not food" call (see backlog #133's own note: `infer_edible_parts`
deliberately doesn't gate on a plant's `is_edible` for exactly this reason,
so the edible_parts backfill never inherited this bug).

One deliberate exception, NOT auto-fixed here: `comfrey` (Symphytum
orientale). Its `edible_parts: ['leaves']` came from an Ollama inference
pass with no cross-check against modern food-safety guidance - comfrey
leaves contain pyrrolizidine alkaloids and mainstream sources (FDA, EMA)
specifically warn against internal/food use, unlike the historical "pot
herb" framing that produced the Ollama inference. That's a genuine
"flag rather than force true blindly" case per the issue's own instruction,
not something this script should resolve unilaterally - left as `is_edible:
false` with `edible_parts` still populated (a real, documented
contradiction) and flagged in data/suggestions.md for a human call instead.

Run from data/: uv run python -m etl.backfill_is_edible
"""

import json

from etl.config import PLANTS_OUT_DIR

# Confirmed 2026-07-27 (issue #165): a real, documented exception where
# edible_parts is populated but is_edible should stay false pending a human
# decision - see the module docstring and data/suggestions.md.
EXCLUDE_SLUGS = {"comfrey"}


def find_contradictions() -> list[dict]:
    """Every plant with edible_parts populated but is_edible false or
    unset - the actual data-quality bug this backfill fixes."""
    contradictions = []
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("edible_parts") and data.get("is_edible") is not True:
            contradictions.append(data)
    return contradictions


def main() -> None:
    contradictions = find_contradictions()
    changed = 0
    skipped = []
    for data in contradictions:
        slug = data["slug"]
        if slug in EXCLUDE_SLUGS:
            skipped.append(slug)
            continue
        data["is_edible"] = True
        data.setdefault("data_sources", []).append(
            {
                "attribution": "manual-research",
                "notes": (
                    "is_edible corrected from false to true (GitHub issue #165): "
                    f"edible_parts={data['edible_parts']!r} was already populated, "
                    "a direct contradiction with is_edible=false, and no is_toxic "
                    "flag or toxicity_notes explained the discrepancy - a full-dataset "
                    "audit found this affecting 120 plants (grown from an earlier "
                    "25-plant spot-check once backlog #133's edible_parts backfill "
                    "widened coverage), all of them unambiguous real food/herb/fruit "
                    "crops."
                ),
            }
        )
        path = PLANTS_OUT_DIR / f"{slug}.json"
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        changed += 1

    print(f"[backfill_is_edible] {changed} plant(s) corrected to is_edible=true")
    if skipped:
        print(f"[backfill_is_edible] {len(skipped)} plant(s) deliberately skipped (see EXCLUDE_SLUGS): {skipped}")


if __name__ == "__main__":
    main()
