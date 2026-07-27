"""One-off backfill for GitHub issue #170: investigate whether the ETL's
source material carries "plant spacing" (distance between individual
plants within a row) as a datapoint distinct from row_spacing_cm (distance
between rows), and populate a new `plant_spacing_cm` field accordingly.

**Investigation finding**: no structured source does. Checked all four:
- openfarm-crops-rescue (etl/sources/openfarm.py): `rowSpacingCm` only.
- Trefle (etl/sources/trefle.py): `main_species.specifications.growth.
  row_spacing.cm` only (verified against a real cached response,
  data/.cache/trefle/celery.json) - no separate in-row figure.
- Homesteader Labs (etl/sources/homesteader.py): a single generic
  `spacing` free-text field ("24-36\" apart"), already mapped to
  row_spacing_cm - no distinction from row spacing at all.
- USDA PLANTS: no spacing data of any kind (taxonomy only).

The only place a genuinely distinct plant-spacing figure appears is old
gardening-book prose already captured in some plants'
`bedding_needs[need_type="spacing"]` notes (from the Project Gutenberg
growing_information pipeline, see data/CLAUDE.md) - e.g. carrot.json:
"rows 12 to 18 inches apart and thinned out to 3 to 5 inches within the
row" states both numbers explicitly. But this only covers a small minority
of plants (20 of 358 have a spacing-type bedding_need at all), and even
among those the phrasing is inconsistent free prose from 7 different
109-120-year-old books (imperial units, ranges, fractions, "X by Y" bush/
tree grid spacing, ambiguous row-vs-plant ordering) - not mechanically
parseable at scale without misreading some of them. Rather than write a
regex parser likely to silently misparse an ambiguous case, this script
hand-derives the confidently-unambiguous subset (`_MANUAL_DERIVATIONS`
below, each with its source note quoted directly) and leaves the rest
alone - same "don't guess, log it" discipline as every other backfill in
this pipeline.

Per the issue's own explicit instruction, every plant NOT in that
confident subset falls back to its existing `row_spacing_cm` value rather
than being left null - clearly tagged in data_sources as a fallback
substitute, not an independently-sourced figure, so nothing downstream
mistakes the two. Plants with no row_spacing_cm either are left null and
logged.

Run from data/: uv run python -m etl.backfill_plant_spacing
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR

UNMATCHED_LOG = DATA_DIR / "plant_spacing_backfill_unmatched.jsonl"

# Hand-derived from each plant's own bedding_needs[need_type="spacing"]
# free-text note (quoted in `source_note` below) - only plants where the
# text unambiguously separates row spacing from in-row plant spacing.
# cm values use the midpoint of a stated range, imperial converted at
# 2.54 cm/in, 30.48 cm/ft. Plants with only a single ambiguous number
# (beet, bonnie-bell-sweet-pepper-sfg, golden-beet, okra, parsnip), a
# multi-cultivar/multi-crop conflation (blackberry, pumpkin), or an
# unclear row-vs-plant attribution were deliberately left out - see
# UNMATCHED_LOG for those.
_MANUAL_DERIVATIONS: dict[str, tuple[float, str]] = {
    "cantaloupe": (121.9, "hills at least four feet apart in the row"),
    "carrot": (10.2, "thinned out to 3 to 5 inches within the row"),
    "cheongyang-chili-pepper": (41.9, "plants 15 to 18 inches within rows"),
    "cherry-tomato": (53.3, "spacing them 18-24 inches apart in rows that are 3.5-4 feet apart"),
    "green-zebra-tomato": (53.3, "18-24 inches apart in rows that are 3½ to 4 feet apart"),
    "kohlrabi": (20.3, "8 inches apart in rows spaced 18 to 36 inches apart"),
    "lacinato-kale": (38.1, "10 to 20 inches apart and rows 12 to 18 inches apart"),
    "parsley": (10.2, "4 inches between each plant"),
    "striped-cavern-tomato": (53.3, "18 inches to 2 feet apart in rows 3½ to 4 feet apart"),
    "sunray-tomato": (53.3, "18 inches to 2 feet apart in rows 3½ to 4 feet apart"),
    "tiny-tim-tomato": (53.3, "space them 18 inches to 2 feet apart in rows 3½ to 4 feet apart"),
    "tomato": (53.3, "18-24 inches apart in rows that are 3.5-4 feet apart"),
    "uf-micro-tom-tomato": (53.3, "18 inches to 2 feet apart in rows 3½ to 4 feet apart"),
}


def main() -> None:
    derived = 0
    fallback = 0
    unmatched: list[dict] = []

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("plant_spacing_cm") is not None:
            continue  # idempotent

        slug = data["slug"]
        if slug in _MANUAL_DERIVATIONS:
            value, source_note = _MANUAL_DERIVATIONS[slug]
            data["plant_spacing_cm"] = value
            data.setdefault("data_sources", []).append(
                {
                    "attribution": "manual-plant-spacing-derivation",
                    "notes": (
                        f"plant_spacing_cm={value} derived from this plant's own bedding_needs "
                        f"spacing note ({source_note!r}) - genuinely distinct from row_spacing_cm, "
                        "not a fallback. See GitHub issue #170 / etl/backfill_plant_spacing.py."
                    ),
                }
            )
            derived += 1
        elif data.get("row_spacing_cm") is not None:
            data["plant_spacing_cm"] = data["row_spacing_cm"]
            data.setdefault("data_sources", []).append(
                {
                    "attribution": "manual-plant-spacing-fallback",
                    "notes": (
                        "plant_spacing_cm substituted from row_spacing_cm (GitHub issue #170: no "
                        "source distinguishes in-row plant spacing from row spacing for this plant) "
                        "- NOT an independently-sourced value, just a carried-over placeholder."
                    ),
                }
            )
            fallback += 1
        else:
            unmatched.append({"slug": slug, "reason": "no row_spacing_cm to fall back to either"})
            continue

        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if unmatched:
        with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
            for entry in unmatched:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"[backfill_plant_spacing] {len(unmatched)} plant(s) had no row_spacing_cm to fall back to - logged to {UNMATCHED_LOG}")

    print(f"[backfill_plant_spacing] done: {derived} plant(s) got a genuinely-derived value, {fallback} got the row_spacing_cm fallback")


if __name__ == "__main__":
    main()
