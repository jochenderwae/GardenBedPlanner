"""Validates a garden fixture JSON: bed schema-shape completeness, planting
bounds (a planting must fall within its own bed's footprint), bed overlap
(no two bed rectangles may overlap in garden-space), and that every
`plantings[].plant_slug` actually refers to a real data/plants/<slug>.json -
the kind of check worth re-running after every regeneration
(etl.generate_example_garden), not a one-off.

Defaults to data/example_garden.json; pass a path as the first CLI arg to
check a different file - e.g. data/example_garden_de_heuvel.json (the real
"De Heuvel" garden backup, see that file's own `_notes`), added for GitHub
issue #178 (a bed-overlap report against the live seeded garden) so this
tool can actually check the one real snapshot of that data available
offline, not just the synthetic demo fixture.

Run with: uv run python -m etl.verify_garden [path] (from data/), or via
the /test-data skill (.claude/skills/test-data/scripts/data_verify_garden.ps1)
for the default example_garden.json.

Exit code is non-zero if any check fails, so this is safe to use as a gate
(e.g. before treating a regenerated example_garden.json as good to commit).

Updated 2026-07-19 (task_queue.md item 9) for the post Garden/Bed redesign
shape: `category`/`border_geometry` (jsonb rectangle|polygon) replaced the
old flat `bed_type`/`pos_x`/`pos_y`/`width_cm`/`length_cm` fields - see
backend/app/models/bed.py. `category` is free-text now (no closed enum to
validate against). Overlap/bounds checks below assume every bed's
border_geometry is a "rectangle" (true for everything
etl.generate_example_garden currently emits) - a "polygon" bed would need
its own bounding-box handling, flagged rather than silently mishandled if
one ever shows up here.

Updated 2026-07-27 (issue #178) to also accept a planting's REAL
`geometry` shape (`{x, y, width, height, rotation}`, as
example_garden_de_heuvel.json uses - see that file's own `_notes` on how
it differs from the demo fixture's flat `x_cm`/`y_cm` points) alongside
the demo fixture's simplified points, so the same bounds/overlap checks
work against either file rather than assuming one fixed shape.
"""

import json
import sys
from pathlib import Path

from etl.config import DATA_DIR, PLANTS_OUT_DIR

EXAMPLE_GARDEN_PATH = DATA_DIR / "example_garden.json"

_REQUIRED_BED_FIELDS = {
    "name", "category", "border_geometry", "height_cm", "has_greenhouse", "notes",
}
_OPTIONAL_BED_FIELDS = {"orientation", "is_raised", "soil_type", "sun_level", "plantings"}


def _bed_rect(b: dict) -> tuple[float, float, float, float] | None:
    """Returns (x, y, width, height) for a rectangle border_geometry, or
    None (with a printed warning) for anything else this generator doesn't
    currently produce."""
    g = b["border_geometry"]
    if g.get("type") != "rectangle":
        print(f"SKIPPING bounds/overlap checks for {b['name']!r}: border_geometry.type {g.get('type')!r} not handled")
        return None
    return g["x"], g["y"], g["width"], g["height"]


# Real Postgres-exported coordinates (example_garden_de_heuvel.json) carry
# genuine floating-point rounding noise from the SQL round-trip (e.g. two
# beds meant to sit exactly flush at x=-170 actually stored as -170.0 and
# -170.0000000000001) - without a tolerance, a strict "<" overlap/bounds
# comparison flags beds that are touching, not actually overlapping, as a
# false positive. 1e-6 cm is many orders of magnitude below anything
# visually or physically meaningful in a garden layout.
_EPSILON_CM = 1e-6


def _planting_point(p: dict) -> tuple[float, float]:
    """A planting's own center point, in bed-local coordinates - what
    actually needs to fall within its bed's bounds. The demo fixture
    (example_garden.json) already stores a flat x_cm/y_cm point directly.
    example_garden_de_heuvel.json (the real Bed/Planting shape) instead
    stores a `geometry` rectangle - a fixed-size rendering marker centered
    on the real point (see backend/app/scripts/import_example_garden.py's
    own x_cm/y_cm -> centered-rectangle conversion) - so its center, not
    the rectangle's own bounds, is the equivalent point. Using the marker
    rectangle's own bounds instead would flag plantings near a bed's edge
    as "out of bounds" for exceeding it by a few cm of marker overflow,
    which isn't a real data problem - a plant can legitimately be sown
    right at a bed's edge."""
    geometry = p.get("geometry")
    if geometry is not None:
        return geometry["x"] + geometry["width"] / 2, geometry["y"] + geometry["height"] / 2
    return p["x_cm"], p["y_cm"]


def _rectangles_overlap(a: dict, b: dict) -> bool:
    ra, rb = _bed_rect(a), _bed_rect(b)
    if ra is None or rb is None:
        return False
    ax0, ay0, aw, ah = ra
    bx0, by0, bw, bh = rb
    ax1, ay1 = ax0 + aw, ay0 + ah
    bx1, by1 = bx0 + bw, by0 + bh
    return (
        ax0 < bx1 - _EPSILON_CM
        and bx0 < ax1 - _EPSILON_CM
        and ay0 < by1 - _EPSILON_CM
        and by0 < ay1 - _EPSILON_CM
    )


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else EXAMPLE_GARDEN_PATH
    if not path.exists():
        print(f"No garden fixture at {path}")
        sys.exit(1)

    data = json.loads(path.read_text(encoding="utf-8"))
    beds = data["beds"]
    known_slugs = {p.stem for p in PLANTS_OUT_DIR.glob("*.json")}

    print(f"{len(beds)} beds total")
    problems = 0

    for b in beds:
        missing = _REQUIRED_BED_FIELDS - set(b.keys())
        extra = set(b.keys()) - _REQUIRED_BED_FIELDS - _OPTIONAL_BED_FIELDS
        if missing:
            print(f"MISSING FIELDS in {b['name']!r}: {missing}")
            problems += 1
        if extra:
            print(f"EXTRA FIELDS in {b['name']!r}: {extra}")
            problems += 1

        rect = _bed_rect(b)
        _, _, bed_w, bed_h = rect if rect else (0, 0, None, None)
        for p in b.get("plantings", []):
            if p["plant_slug"] not in known_slugs:
                print(f"UNKNOWN plant_slug in {b['name']!r}: {p['plant_slug']!r}")
                problems += 1
            if bed_w is not None:
                px, py = _planting_point(p)
                if not (-_EPSILON_CM <= px <= bed_w + _EPSILON_CM and -_EPSILON_CM <= py <= bed_h + _EPSILON_CM):
                    print(f"OUT OF BOUNDS in {b['name']!r}: {p}")
                    problems += 1

    for i in range(len(beds)):
        for j in range(i + 1, len(beds)):
            if _rectangles_overlap(beds[i], beds[j]):
                print(f"OVERLAP: {beds[i]['name']!r} <-> {beds[j]['name']!r}")
                problems += 1

    rects = [_bed_rect(b) for b in beds]
    rects = [r for r in rects if r is not None]
    if rects:
        min_x = min(x for x, y, w, h in rects)
        min_y = min(y for x, y, w, h in rects)
        max_x = max(x + w for x, y, w, h in rects)
        max_y = max(y + h for x, y, w, h in rects)
        print(f"garden bounding box: {max_x - min_x}cm x {max_y - min_y}cm (origin {min_x},{min_y})")

    if problems:
        print(f"FAILED: {problems} problem(s) found")
        sys.exit(1)
    print("OK: no problems found")


if __name__ == "__main__":
    main()
