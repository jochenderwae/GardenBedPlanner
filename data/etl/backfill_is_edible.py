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

`comfrey` (Symphytum orientale) was a deliberate exception here, NOT
auto-fixed, pending a human decision on whether its `edible_parts:
['leaves']` (an Ollama inference with no cross-check against modern
food-safety guidance - comfrey leaves contain pyrrolizidine alkaloids and
mainstream sources like the FDA/EMA specifically warn against internal/food
use) should flip `is_edible` to `false` or stay `true` with a toxicity
caveat. **Resolved via GitHub issue #199 (product-owner decision,
2026-07-29): `is_edible: true` stays, with new `is_toxic: true`/
`toxicity_notes` fields added directly to `data/plants/comfrey.json` to
carry the caveat** - `is_edible`/`is_toxic` are independent fields by
design, not either/or, and comfrey's historical edible use and modern
toxicity warning are both real, documented facts about the same plant part.
`comfrey` is therefore no longer excluded here - it no longer contradicts
`find_contradictions()`'s check (edible_parts populated AND is_edible
already true), so removing it from `EXCLUDE_SLUGS` is a no-op on re-run,
not a behavior change.

Run from data/: uv run python -m etl.backfill_is_edible
"""

import json

from etl.config import PLANTS_OUT_DIR

# Historical note: comfrey was excluded here 2026-07-27..2026-07-29 (issue
# #165) pending a human decision - see the module docstring. Resolved by
# issue #199; no plants are excluded anymore, but the mechanism is kept in
# place in case a similar case comes up again.
EXCLUDE_SLUGS: set[str] = set()


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
