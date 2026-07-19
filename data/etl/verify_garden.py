"""Validates data/example_garden.json: bed schema-shape completeness,
planting bounds (a planting must fall within its own bed's footprint), bed
overlap (no two bed rectangles may overlap in garden-space), and that every
`plantings[].plant_slug` actually refers to a real data/plants/<slug>.json -
the kind of check worth re-running after every regeneration
(etl.generate_example_garden), not a one-off.

Run with: uv run python -m etl.verify_garden (from data/), or via
claudeTools/data_verify_garden.ps1 from the repo root.

Exit code is non-zero if any check fails, so this is safe to use as a gate
(e.g. before treating a regenerated example_garden.json as good to commit).
"""

import json
import sys

from etl.config import DATA_DIR, PLANTS_OUT_DIR

EXAMPLE_GARDEN_PATH = DATA_DIR / "example_garden.json"

_REQUIRED_BED_FIELDS = {
    "name", "bed_type", "width_cm", "length_cm", "height_cm",
    "has_greenhouse", "pos_x", "pos_y", "notes",
}
_VALID_BED_TYPES = {"large_planter", "small_planter", "berry_row", "compost_bin", "fruit_tree"}


def _rectangles_overlap(a: dict, b: dict) -> bool:
    ax0, ax1 = a["pos_x"], a["pos_x"] + a["width_cm"]
    ay0, ay1 = a["pos_y"], a["pos_y"] + a["length_cm"]
    bx0, bx1 = b["pos_x"], b["pos_x"] + b["width_cm"]
    by0, by1 = b["pos_y"], b["pos_y"] + b["length_cm"]
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
        missing = _REQUIRED_BED_FIELDS - set(b.keys()) - {"plantings"}
        extra = set(b.keys()) - _REQUIRED_BED_FIELDS - {"plantings"}
        if missing:
            print(f"MISSING FIELDS in {b['name']!r}: {missing}")
            problems += 1
        if extra:
            print(f"EXTRA FIELDS in {b['name']!r}: {extra}")
            problems += 1
        if b["bed_type"] not in _VALID_BED_TYPES:
            print(f"INVALID bed_type in {b['name']!r}: {b['bed_type']!r}")
            problems += 1

        for p in b.get("plantings", []):
            if p["plant_slug"] not in known_slugs:
                print(f"UNKNOWN plant_slug in {b['name']!r}: {p['plant_slug']!r}")
                problems += 1
            if not (0 <= p["x_cm"] <= b["width_cm"] and 0 <= p["y_cm"] <= b["length_cm"]):
                print(f"OUT OF BOUNDS in {b['name']!r}: {p}")
                problems += 1

    for i in range(len(beds)):
        for j in range(i + 1, len(beds)):
            if _rectangles_overlap(beds[i], beds[j]):
                print(f"OVERLAP: {beds[i]['name']!r} <-> {beds[j]['name']!r}")
                problems += 1

    if beds:
        min_x = min(b["pos_x"] for b in beds)
        min_y = min(b["pos_y"] for b in beds)
        max_x = max(b["pos_x"] + b["width_cm"] for b in beds)
        max_y = max(b["pos_y"] + b["length_cm"] for b in beds)
        print(f"garden bounding box: {max_x - min_x}cm x {max_y - min_y}cm (origin {min_x},{min_y})")

    if problems:
        print(f"FAILED: {problems} problem(s) found")
        sys.exit(1)
    print("OK: no problems found")


if __name__ == "__main__":
    main()
