"""One-off cleanup pass for common_name capitalization drift in
already-exported data/plants/*.json (sources disagree wildly - 'bitter
orange', 'Adjuma pepper', 'Matariki Taewa Potato' all seen for real).
export.py now normalizes on every future run (see title_case_plant_name in
normalize.py) - this just catches up files exported before that existed.

Run from data/: uv run python -m etl.normalize_common_names
"""

import json

from etl.config import PLANTS_OUT_DIR
from etl.normalize import title_case_plant_name


def main() -> None:
    changed = 0
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        normalized = title_case_plant_name(data.get("common_name", ""))
        if normalized != data.get("common_name"):
            print(f"[normalize] {data['slug']}: {data['common_name']!r} -> {normalized!r}")
            data["common_name"] = normalized
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            changed += 1
    print(f"[normalize] done: {changed} plant(s) updated")


if __name__ == "__main__":
    main()
