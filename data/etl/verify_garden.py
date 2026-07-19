"""Validates data/example_garden.json: bed schema-shape completeness,
planting bounds (a planting must fall within its own bed's footprint), bed
overlap (no two bed rectangles may overlap in garden-space), and that every
`plantings[].plant_slug` actually refers to a real data/plants/<slug>.json -
the kind of check worth re-running after every regeneration
(etl.generate_example_garden), not a one-off.

Run with: uv run python -m etl.verify_garden (from data/), or via the
/test-data skill (.claude/skills/test-data/scripts/data_verify_garden.ps1).

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
"""

import json
import sys

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


def _rectangles_overlap(a: dict, b: dict) -> bool:
    ra, rb = _bed_rect(a), _bed_rect(b)
    if ra is None or rb is None:
        return False
    ax0, ay0, aw, ah = ra
    bx0, by0, bw, bh = rb
    ax1, ay1 = ax0 + aw, ay0 + ah
    bx1, by1 = bx0 + bw, by0 + bh
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


def main() -> None:
    if not EXAMPLE_GARDEN_PATH.exists():
        print(f"No example garden at {EXAMPLE_GARDEN_PATH}")
        sys.exit(1)

    data = json.loads(EXAMPLE_GARDEN_PATH.read_text(encoding="utf-8"))
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
            if bed_w is not None and not (0 <= p["x_cm"] <= bed_w and 0 <= p["y_cm"] <= bed_h):
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
