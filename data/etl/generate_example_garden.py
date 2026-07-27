"""One-off task: generate data/example_garden.json - a realistic example
garden layout modeling the actual physical garden described in root
CLAUDE.md, for the WYSIWYG bed editor (frontend work starting in parallel)
to have something real to render while it's being built, and later for the
backlogged "load example data on install" feature (product-owner/BACKLOG.md
's Plant database section).

## New Bed shape (2026-07-19 update, task_queue.md item 9)

Regenerated after the Garden/Bed model redesign (new Garden/Planting/
BedEquipment tables, Bed.border_geometry replacing the old flat
bed_type/pos_x/pos_y/width_cm/length_cm fields - see
backend/app/models/bed.py). Each bed now emits:

- `category` (free-text, was the closed bed_type enum - the same values
  used before, e.g. "large_planter", are still perfectly good category
  strings, there's just no enum validating them anymore)
- `border_geometry` ({"type": "rectangle", "x", "y", "width", "height",
  "rotation": 0} - garden-space cm, per docs/schema.md's "Geometry format".
  Every bed this generator makes is axis-aligned, so rotation: 0 throughout
  is correct, not a placeholder)
- `height_cm`/`has_greenhouse`/`notes` unchanged
- `orientation`/`soil_type`/`sun_level` left unset (null) - no well-founded
  values for this invented layout, per the task's own instruction not to
  force values that aren't confident
- `is_raised` set where there's a reasonably confident answer: True for the
  large/small planters (built raised-bed kits per root CLAUDE.md), False for
  the ground-level compost bins, berry row, and fruit-tree beds (a mulched
  root-zone bed, not a raised kit)

`plantings[].{plant_slug, x_cm, y_cm}` is unchanged - the read-only
`/api/example-garden` preview endpoint (backend/app/api/routes/
example_garden.py) deliberately kept this flat bed-local shape rather than
adopting the real Planting model's Geometry column, so there's nothing to
convert here.

Now imported into Postgres by backend/app/scripts/import_example_garden.py
(the "future analogous importer" data-engineer's own CLAUDE.md anticipated) -
that script converts each flat x_cm/y_cm point into a small centered
rectangle Geometry for the real Planting.geometry column, since Geometry has
no bare point/marker variant (see that script's own docstring).

## Bed dimension interpretation (no real layout is recorded anywhere)

Root CLAUDE.md gives dimensions as "70x70x200cm" (large planters) and
"30x70x70cm" (small planters) without labeling which number is which axis.
Both triples have two matching numbers and one different one; the only
physically sensible reading is that the *different* number is the long
axis and the *two matching* numbers are width and height - a 200cm-tall or
30cm-tall raised bed isn't a real product, but a 200cm-long x 70cm-wide x
70cm-tall bed is a completely standard raised-bed kit size (also matches
common Belgian/EU raised-bed kit listings, e.g. "200x70x70cm Hochbeet").
So: large planters = width 70, height (footprint depth) 200, height_cm 70.
Small planters = width 30, height (footprint depth) 70, height_cm 70 (same
build height as the large planters, for a consistent build height across
the garden).

Berry row and fruit tree bed footprints aren't described at all in root
CLAUDE.md - invented from scratch: a berry row needs to be long enough to
give each of 5 plants (raspberry, blueberry, redcurrant, gooseberry,
sunflowers) real room per their own spread_cm/row_spacing_cm, and a fruit
tree needs a mulched root-zone bed, not the eventual mature canopy.

## Layout

A rectangular garden roughly 6.2m x 6.5m. Coordinate convention (not
specified by the Bed model, chosen here and documented since the frontend
needs to know it): border_geometry.x/y is each bed's top-left corner in
garden-space cm; border_geometry.width extends along +x,
border_geometry.height extends along +y. Within a bed, plantings' x_cm/y_cm
use the same convention relative to the bed's own top-left corner, per
task_queue.md's spec.

- Row of 4 large planters along the top (y=0..200), 60cm paths between them
  for wheelbarrow/kneeling access. First one has the greenhouse.
- A 100cm cross-path, then a row of 3 small planters (y=300..370).
- 2 compost bins next to the small planters (y=300..400), out of the way of
  planting beds but close enough for short manure/compost hauls.
- The berry row runs the full height of the garden along the right edge
  (x=540..620), clear of every other bed with an 80cm path.
- The 2 fruit trees sit in the open area at the bottom, given generous
  separation from each other and from the beds (trees need root/canopy
  room and shouldn't shade the vegetable beds).

## Plant choices

Per task_queue.md's guidance: root veg/leafy greens in the small planters
(quick, shallow-rooted crops suit the smaller footprint), larger fruiting
vegetables in the large planters, the greenhouse bed reserved for the most
heat-loving crops (tomatoes, peppers - genuinely useful in Belgium's
climate). Every bed's plant combination was checked against real
`companions[].relationship` data for the whole set with a small script
before finalizing (see the outcome note in task_queue.md for the exact
check) - no bed combines two plants with a declared 'bad' relationship, and
several combinations are backed by an explicit 'good' entry in real data
(tomato+basil, acorn-squash+borage, cucumber+beans-bush, spinach+lettuce).

Updated 2026-07-27 (GitHub issue #158): the "Sour Cherry Tree" bed now uses
a real dedicated data/plants/sour-cherry.json (Prunus cerasus) record
instead of the earlier placeholder use of the generic cherry.json (sweet
cherry, Prunus avium). cherry.json's own height_cm=1500 units error
(GitHub issue #159) was also fixed separately - neither bed's sizing was
ever affected by it, since this generator's fruit_tree beds are sized by
the bed's own fixed footprint, not a plant's height_cm.

## Planting placement algorithm

For each bed, plants share the bed's long axis in equal-length strips (one
strip per distinct plant), and within its strip each plant is arranged in a
small centered grid using max(spread_cm, row_spacing_cm) as the spacing
(falling back to a conservative 40cm default for the handful of plants with
neither - e.g. brandywine-tomato, sour-cherry, pear - flagged in the per-bed
notes). Instance count per plant is capped at 6 - this is an illustrative
fixture, not an attempt to fill every possible cm, so a bed reads clearly as
"there's a stand of X here" without the file (or the canvas) getting
cluttered. A lone tree in a fruit_tree bed is just placed at the bed's
center - a grid doesn't apply to a single plant.

Run from data/: uv run python -m etl.generate_example_garden
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR

OUT_PATH = DATA_DIR / "example_garden.json"

_DEFAULT_SPACING_CM = 40.0
_MAX_INSTANCES_PER_PLANT = 6
_MARGIN_CM = 5.0

# Categories confidently known to be built as raised-bed kits (root
# CLAUDE.md describes both planter sizes as such). Everything else in this
# fixture (compost bins, berry row, fruit trees) is ground-level.
_RAISED_CATEGORIES = {"large_planter", "small_planter"}

# (name, category, width_cm, length_cm, height_cm, has_greenhouse, pos_x, pos_y, notes, plant_slugs)
_BEDS = [
    (
        "Large Planter 1 (Greenhouse)", "large_planter", 70, 200, 70, True, 0, 0,
        "Heat-loving nightshades - the greenhouse gives tomatoes/peppers a real "
        "head start and season extension in Belgium's climate.",
        ["brandywine-tomato", "cherry-tomato", "basil", "bell-pepper"],
    ),
    (
        "Large Planter 2", "large_planter", 70, 200, 70, False, 130, 0,
        "Cucumber trellised at one end, bush beans and dill filling the rest - "
        "beans+cucumber is a confirmed 'good' companion pairing in our data.",
        ["cucumber", "beans-bush", "dill"],
    ),
    (
        "Large Planter 3", "large_planter", 70, 200, 70, False, 260, 0,
        "Eggplant and zucchini with African marigold interplanted for pest "
        "deterrence.",
        ["eggplant", "zucchini", "african-marigold"],
    ),
    (
        "Large Planter 4", "large_planter", 70, 200, 70, False, 390, 0,
        "Acorn squash (a real ground-sprawling vine, spread_cm=150 - most of "
        "this bed on its own) with borage, a companion pairing confirmed "
        "directly in acorn-squash's own data.",
        ["acorn-squash", "borage"],
    ),
    (
        "Small Planter 1", "small_planter", 30, 70, 70, False, 0, 300,
        "Quick roots: carrot with a fast-maturing radish nurse crop and "
        "chives (a confirmed 'good' companion for carrot).",
        ["carrot", "french-breakfast-radish", "chives"],
    ),
    (
        "Small Planter 2", "small_planter", 30, 70, 70, False, 70, 300,
        "Leafy greens - lettuce and spinach are a confirmed 'good' pairing; "
        "arugula fills the gaps.",
        ["lettuce", "spinach", "arugula"],
    ),
    (
        "Small Planter 3", "small_planter", 30, 70, 70, False, 140, 300,
        "Beet, golden beet, and lambs lettuce (mache) - a cool-season mix "
        "popular in Belgian kitchen gardens.",
        ["beet", "golden-beet", "lambs-lettuce"],
    ),
    (
        "Compost Bin 1", "compost_bin", 100, 100, 100, False, 230, 300,
        "1m3 bin - garden waste + kitchen scraps.", [],
    ),
    (
        "Compost Bin 2", "compost_bin", 100, 100, 100, False, 370, 300,
        "1m3 bin - second bin for turning/maturing while the first fills.", [],
    ),
    (
        "Berry Row", "berry_row", 80, 600, 0, False, 540, 0,
        "Raspberry, blueberry, redcurrant, gooseberry, and a stand of "
        "sunflowers at the far end - no 'bad' companion pairings among any "
        "of these five in our data (checked pairwise).",
        ["raspberry", "blueberry", "red-currant", "gooseberry", "sunflower"],
    ),
    (
        "Sour Cherry Tree", "fruit_tree", 150, 150, 0, False, 0, 500,
        "Sour cherry - data/plants/sour-cherry.json (Prunus cerasus, added for "
        "GitHub issue #158) is a direct match, replacing the earlier "
        "placeholder use of the generic cherry.json (sweet cherry) record.",
        ["sour-cherry"],
    ),
    (
        "Pear Tree", "fruit_tree", 150, 150, 0, False, 300, 500,
        "Pear - data/plants/pear.json (Pyrus communis) is a direct match.",
        ["pear"],
    ),
]

_NOTES = (
    "Invented layout/fixture - see data/etl/generate_example_garden.py's "
    "module docstring for the full reasoning (bed dimension interpretation, "
    "coordinate convention, plant/companion choices, placement algorithm). "
    "No real layout for this garden is recorded anywhere; root CLAUDE.md "
    "only gives bed counts/types/sizes and berry-row/tree species, not "
    "positions or exact per-bed plant assignments. Garden footprint is "
    "roughly 6.2m x 6.5m. Bed shape matches the current Bed model "
    "(category/border_geometry, post Garden/Bed redesign) - regenerate with "
    "`uv run python -m etl.generate_example_garden` if plant data changes "
    "meaningfully (e.g. spread_cm/row_spacing_cm backfilled for the plants "
    "noted below as falling back to a default spacing)."
)


def _spacing_for(slug: str, plant: dict) -> tuple[float, bool]:
    """Returns (spacing_cm, used_default)."""
    spacing = plant.get("spread_cm") or plant.get("row_spacing_cm")
    if spacing:
        return float(spacing), False
    return _DEFAULT_SPACING_CM, True


def _grid_positions(width_cm: float, length_cm: float, spacing: float, max_count: int) -> list[tuple[float, float]]:
    usable_w = max(width_cm - 2 * _MARGIN_CM, spacing)
    usable_l = max(length_cm - 2 * _MARGIN_CM, spacing)
    cols = max(1, int(usable_w // spacing) + 1)
    rows = max(1, int(usable_l // spacing) + 1)
    # Cap total instances for readability - reduce rows first, then cols.
    while cols * rows > max_count and rows > 1:
        rows -= 1
    while cols * rows > max_count and cols > 1:
        cols -= 1

    grid_w = (cols - 1) * spacing
    grid_l = (rows - 1) * spacing
    x_start = _MARGIN_CM + (width_cm - 2 * _MARGIN_CM - grid_w) / 2
    y_start = _MARGIN_CM + (length_cm - 2 * _MARGIN_CM - grid_l) / 2

    positions = []
    for r in range(rows):
        for c in range(cols):
            positions.append((round(x_start + c * spacing, 1), round(y_start + r * spacing, 1)))
    return positions


def _build_bed(name, category, width_cm, length_cm, height_cm, has_greenhouse, pos_x, pos_y, notes, plant_slugs):
    plantings = []
    defaults_used = []

    if plant_slugs:
        n = len(plant_slugs)
        strip_length = length_cm / n
        for i, slug in enumerate(plant_slugs):
            path = PLANTS_OUT_DIR / f"{slug}.json"
            if not path.exists():
                raise SystemExit(f"generate_example_garden: {slug!r} referenced in {name!r} has no data/plants/{slug}.json")
            plant = json.loads(path.read_text(encoding="utf-8"))
            spacing, used_default = _spacing_for(slug, plant)
            if used_default:
                defaults_used.append(slug)

            strip_y0 = i * strip_length
            if n == 1 and category == "fruit_tree":
                # A lone tree: one point at the bed's center, no grid.
                plantings.append({"plant_slug": slug, "x_cm": round(width_cm / 2, 1), "y_cm": round(length_cm / 2, 1)})
                continue

            for x, y in _grid_positions(width_cm, strip_length, min(spacing, strip_length, width_cm), _MAX_INSTANCES_PER_PLANT):
                plantings.append({"plant_slug": slug, "x_cm": x, "y_cm": round(strip_y0 + y, 1)})

    bed_notes = notes
    if defaults_used:
        bed_notes += f" (spacing defaulted to {_DEFAULT_SPACING_CM:.0f}cm for: {', '.join(defaults_used)} - no spread_cm/row_spacing_cm in their data yet)"

    bed = {
        "name": name,
        "category": category,
        "border_geometry": {
            "type": "rectangle",
            "x": pos_x,
            "y": pos_y,
            "width": width_cm,
            "height": length_cm,
            "rotation": 0,
        },
        "height_cm": height_cm,
        "has_greenhouse": has_greenhouse,
        "is_raised": category in _RAISED_CATEGORIES,
        "notes": bed_notes,
    }
    if plantings:
        bed["plantings"] = plantings
    return bed


def main() -> None:
    beds = [_build_bed(*b) for b in _BEDS]
    out = {"_notes": _NOTES, "beds": beds}
    OUT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total_plantings = sum(len(b.get("plantings", [])) for b in beds)
    print(f"[example-garden] wrote {OUT_PATH} - {len(beds)} beds, {total_plantings} planting instances")


if __name__ == "__main__":
    main()
