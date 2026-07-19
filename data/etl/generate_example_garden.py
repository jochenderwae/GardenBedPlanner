"""One-off task: generate data/example_garden.json - a realistic example
garden layout modeling the actual physical garden described in root
CLAUDE.md, for the WYSIWYG bed editor (frontend work starting in parallel)
to have something real to render while it's being built, and later for the
backlogged "load example data on install" feature (product-owner/BACKLOG.md
's Plant database section).

Not imported into Postgres by anything yet (no BedPlanting model exists) -
a dev/demo fixture. Each bed's fields match backend/app/models/bed.py's
Bed model exactly (name, bed_type, width_cm, length_cm, height_cm,
has_greenhouse, pos_x, pos_y, notes - id omitted, server-assigned), plus a
`plantings` array (not a real table yet - see docs/schema.md's aspirational
BED_PLANTING for what that might look like eventually, but this task was
scoped to the simpler point-based x_cm/y_cm-in-bed-local-coordinates format
task_queue.md itself specified, not that richer geometry format).

## Bed dimension interpretation (no real layout is recorded anywhere)

Root CLAUDE.md gives dimensions as "70x70x200cm" (large planters) and
"30x70x70cm" (small planters) without labeling which number is which axis.
Both triples have two matching numbers and one different one; the only
physically sensible reading is that the *different* number is the long
axis and the *two matching* numbers are width and height - a 200cm-tall or
30cm-tall raised bed isn't a real product, but a 200cm-long x 70cm-wide x
70cm-tall bed is a completely standard raised-bed kit size (also matches
common Belgian/EU raised-bed kit listings, e.g. "200x70x70cm Hochbeet").
So: large planters = width_cm 70, length_cm 200, height_cm 70. Small
planters = width_cm 30, length_cm 70, height_cm 70 (same height as the
large planters, for a consistent build height across the garden).

Berry row and fruit tree bed footprints aren't described at all in root
CLAUDE.md - invented from scratch: a berry row needs to be long enough to
give each of 5 plants (raspberry, blueberry, redcurrant, gooseberry,
sunflowers) real room per their own spread_cm/row_spacing_cm, and a fruit
tree needs a mulched root-zone bed, not the eventual mature canopy.

## Layout

A rectangular garden roughly 6.2m x 6.5m. Coordinate convention (not
specified by the Bed model, chosen here and documented since the frontend
will need to know it): pos_x/pos_y is each bed's top-left corner in
garden-space cm; width_cm extends along +x, length_cm extends along +y.
Within a bed, plantings' x_cm/y_cm use the same convention relative to the
bed's own top-left corner, per task_queue.md's spec.

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

One data gap worth flagging: there is no dedicated "sour cherry" cultivar
record (root CLAUDE.md's actual tree) - data/plants/cherry.json is a
generic Prunus avium (sweet cherry) record whose own text/growing_information
discusses sour Prunus cerasus varieties too. Used here as the closest real
match rather than inventing a new plant record (out of this task's scope) -
flagged in suggestions.md. Also flagged there: cherry.json's height_cm of
1500 (15m) looks like a units/data error, not used for this bed's sizing.

## Planting placement algorithm

For each bed, plants share the bed's long axis in equal-length strips (one
strip per distinct plant), and within its strip each plant is arranged in a
small centered grid using max(spread_cm, row_spacing_cm) as the spacing
(falling back to a conservative 40cm default for the handful of plants with
neither - e.g. brandywine-tomato, cherry, pear - flagged in the per-bed
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

# (name, bed_type, width_cm, length_cm, height_cm, has_greenhouse, pos_x, pos_y, notes, plant_slugs)
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
        "Sour cherry - no dedicated sour-cherry cultivar record exists yet; "
        "using data/plants/cherry.json (generic Prunus avium record whose "
        "own text also covers Prunus cerasus/sour varieties) as the closest "
        "real match. See suggestions.md.",
        ["cherry"],
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
    "roughly 6.2m x 6.5m. Regenerate with "
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


def _build_bed(name, bed_type, width_cm, length_cm, height_cm, has_greenhouse, pos_x, pos_y, notes, plant_slugs):
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
            if n == 1 and bed_type == "fruit_tree":
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
        "bed_type": bed_type,
        "width_cm": width_cm,
        "length_cm": length_cm,
        "height_cm": height_cm,
        "has_greenhouse": has_greenhouse,
        "pos_x": pos_x,
        "pos_y": pos_y,
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
