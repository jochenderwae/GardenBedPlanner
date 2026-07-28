"""GitHub issue #61: populate `seed_info.seeds_per_gram`, sourced from a
real seed-catalog/seed-bank reference.

**Sourcing decision (the research half of this ticket)** - see the full
trail in the issue's own comments for what was tried and ruled out first
(SER-SID/Kew's Seed Information Database - a client-rendered SPA with no
documented public API, and scoped to wild/restoration species rather than
garden crops anyway; USDA PLANTS' newer site - no bulk seeds-per-pound
endpoint found; Trefle - confirmed no seed-weight-equivalent field exists
in its schema; a Bioversity International genebank handbook - dead link;
USDA GRIN-Global - genuinely public domain (US federal government work)
but its "1000 seed weight" data lives per-accession, not as a queryable
bulk species-level dataset, and would need per-accession averaging outside
this ticket's reasonable scope).

What this settled on instead: **University of Maryland Extension's "Table
G-1: Vegetable Seed Sizes"**
(https://extension.umd.edu/sites/extension.umd.edu/files/2021-03/G-1.pdf),
cross-checked for consistency against near-identical tables independently
published by several other US land-grant extension services (University
of Missouri Extension G6201, Oregon State University Extension, UGA
Extension's C963 vegetable chart, UC Davis) that were found via the same
search - all state ranges consistent with UMD's to within the same order
of magnitude, which is real corroborating evidence these are standard,
widely-known industry seed-count facts rather than one publisher's own
original compiled expression. No source found states an explicit open
license (state university extension services typically hold a general
copyright on their bulletins, with no CC/public-domain marking), but two
things justify using the *facts* here rather than treating this as
blocked on an unresolved licensing question: (1) under US copyright law
(Feist Publications v. Rural Telephone Service, 1991), raw factual data -
a species' seed count per unit weight - is not itself copyrightable, only
a particular creative selection/arrangement of facts can be, and this
script re-derives individual numeric facts into this project's own
schema/structure rather than reproducing UMD's table verbatim; (2) the
same values being independently published near-identically by multiple
unrelated institutions is itself evidence these are objective agronomic
facts in wide circulation, not one party's protectable compilation. This
mirrors the "manual-research" precedent already used elsewhere in this
pipeline (see export.py's _MANUAL_BOTANICAL_NAME_OVERRIDES and
task_queue.md's tasks 7/8) for citing external facts with attribution
rather than bulk-scraping/redistributing a source's own compiled work.

**Coverage is inherently partial by design** - like seed_info as a whole,
this only ever applies to plants whose crop type appears in UMD's ~40
generic vegetable categories (a garden-vegetable seed-size reference, not
a general plant database) with a confident category match. Fruit trees,
berries, herbs, ornamentals, and vegetables UMD doesn't cover (e.g.
turnip, rutabaga, mustard - none of which happen to have a matching plant
record in this database anyway) are left null, same as every other
partial-coverage field in this pipeline (schema: "omit entirely if
nothing is known" is the norm, not a gap to force-fill).

**Matching plants to a UMD category** (_match_category below): mostly
driven by genus + a species-name substring check on botanical_name (e.g.
genus Capsicum -> peppers covers ~24 pepper cultivars in one rule; genus
Solanum + "lycopersicum" -> tomatoes covers ~17 tomato cultivars). A small
curated _SLUG_OVERRIDES dict handles cases genus/species alone can't
resolve correctly - most of these are Cucurbita pepo/moschata/maxima
cultivars where summer vs. winter squash vs. pumpkin is a matter of which
cultivar, not which species (acorn squash and zucchini are both literally
Cucurbita pepo); a few are brassica cultivars where only the exact
matching UMD category (cabbage = var. capitata; cauliflower = var.
botrytis, which includes romanesco) is used rather than guessing at
crucifer varieties UMD's table doesn't separately list (kohlrabi, bok
choy, mizuna, rapini, tatsoi, turnip, red russian kale - all left
unmatched, not guessed). One genuine plant-data quality issue surfaced by
this matching pass: cucumber.json's `genus` is "Ecballium" (squirting
cucumber, an inedible wild relative) rather than "Cucumis" - a real
mismatch flagged in suggestions.md rather than silently worked around;
cucumber-straight-eight.json (a real Cucumis sativus cultivar) is matched
instead.

Every populated value is source-tagged in data_sources
("university-extension-seed-size-reference") with the matched UMD
category, the raw range, and the conversion math, so it's auditable and
distinguishable from every other kind of source in this pipeline.

Run from data/: uv run python -m etl.backfill_seeds_per_gram
"""

import json

import jsonschema

from etl.config import PLANT_SCHEMA_PATH, PLANTS_OUT_DIR

_LB_TO_G = 453.59237
_OZ_TO_G = 28.349523125

# Table G-1, "Vegetable Seed Sizes" (University of Maryland Extension,
# https://extension.umd.edu/sites/extension.umd.edu/files/2021-03/G-1.pdf)
# - (low, high, unit) exactly as printed. Cross-checked for consistency
# against Univ. of Missouri Extension G6201, Oregon State University
# Extension, and UGA Extension's C963 vegetable planting chart (all in the
# same range) - see module docstring for the sourcing/licensing rationale.
_UMD_TABLE: dict[str, tuple[float, float, str]] = {
    "asparagus": (13000, 20000, "lb"),
    "beans_snap": (1600, 2200, "lb"),
    "beets": (24000, 26000, "lb"),
    "broccoli": (8500, 9000, "oz"),
    "cabbage": (8500, 9000, "oz"),
    "cauliflower": (8900, 10000, "oz"),
    "carrots": (300000, 400000, "lb"),
    "celery": (60000, 72000, "oz"),
    "collards": (7500, 8500, "oz"),
    "cucumbers": (15000, 16000, "lb"),
    "eggplants": (6000, 6500, "oz"),
    "endive_escarole": (22000, 26000, "oz"),
    "kale": (7500, 8900, "oz"),
    "leeks": (170000, 180000, "lb"),
    "lettuce_head": (20000, 25000, "oz"),
    "lettuce_leaf": (25000, 31000, "oz"),
    "muskmelons": (16000, 19000, "lb"),
    "okra": (450, 550, "oz"),
    "onions_bulb": (105000, 144000, "lb"),
    "onions_bunching": (180000, 200000, "lb"),
    "parsnips": (7500, 12000, "oz"),
    "parsley": (240000, 288000, "lb"),
    "peas": (1440, 2580, "lb"),
    "peppers": (4000, 4700, "oz"),
    "pumpkins": (1900, 3200, "lb"),
    "radishes": (40000, 50000, "lb"),
    "spinach": (25000, 50000, "lb"),
    "squash_summer": (3500, 4800, "lb"),
    "squash_winter": (1600, 4000, "lb"),
    "sweet_corn": (1800, 2500, "lb"),
    "tomatoes_fresh": (10000, 11400, "oz"),
    "watermelons_small_seed": (8000, 10400, "lb"),
}

# Cultivar-level overrides for cases genus/species-substring matching
# (_match_category) can't resolve correctly on its own - see module
# docstring for why each cluster needs this.
_SLUG_OVERRIDES: dict[str, str] = {
    # Cucurbita cultivars - summer/winter/pumpkin is a cultivar distinction,
    # not a species one (C. pepo alone covers all three).
    "acorn-squash": "squash_winter",
    "baby-bear-pumpkin": "pumpkins",
    "butternut-squash": "squash_winter",
    "delicata-squash": "squash_winter",
    "kamokamo": "squash_summer",
    "pattypan-squash": "squash_summer",
    "pumpkin": "pumpkins",
    "red-kuri-squash": "squash_winter",
    "spaghetti-squash": "squash_winter",
    "squash-summer": "squash_summer",
    "squash-winter": "squash_winter",
    "zucchini": "squash_summer",
    # beans-bush's own `genus` field is wrong (Macroptilium, not
    # Phaseolus - see suggestions.md); this is unmistakably a garden bush
    # bean by common_name, so force the match rather than skip it.
    "beans-bush": "beans_snap",
    # Lettuce head/leaf type isn't in botanical_name (all Lactuca sativa).
    "lettuce": "lettuce_head",
    "romaine-lettuce": "lettuce_head",
    "looseleaf-lettuce": "lettuce_leaf",
    "lettuce-drunken-woman": "lettuce_leaf",
    # Brassica oleracea cultivars - only match UMD's exact named categories
    # (true cabbage = var. capitata, cauliflower group = var. botrytis
    # which includes romanesco); every other oleracea form UMD doesn't
    # separately list (kohlrabi, kai-lan, sea kale, etc.) is left unmatched.
    "cabbage": "cabbage",
    "red-cabbage": "cabbage",
    "red-pointed-cabbage": "cabbage",
    "purple-cauliflower": "cauliflower",
    "yellow-cauliflower": "cauliflower",
    "romanesco": "cauliflower",
    "cauliflower": "cauliflower",
    "broccoli": "broccoli",
    "kale": "kale",
    "lacinato-kale": "kale",
    "collard-greens": "collards",
    "corn": "sweet_corn",
    "watermelon": "watermelons_small_seed",
    "cucumber-straight-eight": "cucumbers",
    "asparagus": "asparagus",
    "leek": "leeks",
    "spinach": "spinach",
    "okra": "okra",
    "parsley": "parsley",
    "parsnip": "parsnips",
    "endive": "endive_escarole",
}


def _match_category(slug: str, genus: str | None, botanical_name: str | None) -> str | None:
    """Returns a _UMD_TABLE key, or None if no confident match. Curated
    overrides win first; everything else is genus + a species-name
    substring check on botanical_name (never a bare genus match alone,
    except Capsicum/Pisum where every species in this database's actual
    data is a garden-edible one - see docstring)."""
    if slug in _SLUG_OVERRIDES:
        return _SLUG_OVERRIDES[slug]

    genus = genus or ""
    botanical = botanical_name or ""

    if genus == "Capsicum":
        return "peppers"
    if genus == "Solanum" and "lycopersicum" in botanical:
        return "tomatoes_fresh"
    if genus == "Solanum" and "melongena" in botanical:
        return "eggplants"
    if genus == "Phaseolus" and "vulgaris" in botanical:
        return "beans_snap"
    if genus == "Raphanus" and "sativus" in botanical:
        return "radishes"
    if genus == "Cucumis" and botanical.startswith("Cucumis melo"):
        return "muskmelons"
    if genus == "Daucus" and "carota" in botanical:
        return "carrots"
    if genus == "Beta" and "vulgaris" in botanical:
        return "beets"
    if genus == "Pisum" or "Pisum sativum" in botanical:
        return "peas"
    if genus == "Allium" and botanical.startswith("Allium cepa"):
        return "onions_bulb"
    if genus == "Allium" and "fistulosum" in botanical:
        return "onions_bunching"
    if genus == "Apium" and "graveolens" in botanical:
        return "celery"

    return None


def _seeds_per_gram(category: str) -> tuple[float, str]:
    low, high, unit = _UMD_TABLE[category]
    per_unit = _LB_TO_G if unit == "lb" else _OZ_TO_G
    value = round(((low + high) / 2) / per_unit, 2)
    range_note = f"{low:,.0f}-{high:,.0f} seeds/{unit}"
    return value, range_note


def main() -> None:
    with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
        schema = json.load(f)

    matched = 0
    skipped_existing = 0
    unmatched = 0

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        slug = data["slug"]

        existing = data.get("seed_info") or {}
        if existing.get("seeds_per_gram") is not None:
            skipped_existing += 1
            continue

        category = _match_category(slug, data.get("genus"), data.get("botanical_name"))
        if category is None:
            unmatched += 1
            continue

        value, range_note = _seeds_per_gram(category)
        data.setdefault("seed_info", {})
        data["seed_info"]["seeds_per_gram"] = value
        data.setdefault("data_sources", []).append(
            {
                "source_url": "https://extension.umd.edu/sites/extension.umd.edu/files/2021-03/G-1.pdf",
                "attribution": "university-extension-seed-size-reference",
                "notes": (
                    f"seeds_per_gram={value} derived from University of Maryland Extension's "
                    f"'Table G-1: Vegetable Seed Sizes', category '{category}' ({range_note}, "
                    "midpoint converted to seeds/gram); cross-referenced for consistency against "
                    "several other independent university extension seed-size tables (see GitHub "
                    "issue #61 / etl/backfill_seeds_per_gram.py for the full sourcing/licensing "
                    "rationale, including why this is treated as factual data rather than a "
                    "protectable compilation)."
                ),
            }
        )
        jsonschema.validate(data, schema)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        matched += 1
        print(f"[seeds-per-gram] {slug}: {value} seeds/g ({category})")

    print(
        f"[seeds-per-gram] done: {matched} matched, "
        f"{skipped_existing} already had a value, {unmatched} no confident category match"
    )


if __name__ == "__main__":
    main()
