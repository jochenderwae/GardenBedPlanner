"""One-off backfill for GitHub issue #177: investigate whether the ETL's
source material carries more detailed sowing information than
`sowing_method` (free text) already captures - sowing depth, indoor vs.
greenhouse vs. direct-in-place vs. direct-in-bed sowing, and whether
shoots need thinning - and add whichever of those have good coverage.

**Investigation findings** (full-dataset scan, see this module's own
regexes below for the exact patterns checked):
- **Sowing depth**: only ~1% of plants (4 of 358) state a depth anywhere
  in `sowing_method` ("Sow 1cm deep", "3-4 cm deep") - nowhere near good
  coverage. Not added.
- **Greenhouse**: the word "greenhouse" appears in ZERO plants'
  `sowing_method` values. Not added - the app already has a bed-level
  `has_greenhouse` flag (`backend/app/models/bed.py`) covering greenhouse
  use; nothing in this data ties a *sowing recommendation* to a
  greenhouse specifically.
- **Direct-in-place vs. direct-in-bed**: no source text actually
  distinguishes these as two different things - "direct seed"/"direct
  sow" language never contrasts "in place" against "in a bed" the way the
  issue's phrasing implies it might. Collapsed into one `sow_direct`
  field rather than inventing a distinction the data doesn't support.
- **Indoors**: ~32% of all plants (114 of 280 with a `sowing_method` at
  all) explicitly say to start/sow indoors - real, useful, if partial,
  coverage. Added as `sow_indoors`.
- **Direct-sown**: ~54% of plants (193 of 358) explicitly say "direct
  seed"/"direct sow" - the single best-covered signal here. Added as
  `sow_direct`.
- **Thinning**: ~11% from `sowing_method` alone, but widens to ~33% (118
  of 358) once `growing_information` text is included too (the same
  corpus GitHub issues #153/#170 already mined for related gaps). Added
  as `needs_thinning`.

For reference, these fill rates (32-54%) are actually higher than two
fields already in this schema with the same "add it even though most
plants are null" precedent: `needs_wind_cover` (23/358, ~6%) and
`needs_rain_cover` (94/358, ~26%).

All three are booleans, `true`-or-`null` only (never a derived `false`) -
consistent with this pipeline's "omit rather than guess" discipline
(plant.schema.json's own `periods` field description says exactly this):
absence of a keyword doesn't prove the opposite is true, it just means
nothing was stated either way.

`sow_indoors`/`sow_direct` are sourced from `sowing_method` only (the
field that's specifically about sowing method - `growing_information` is
broader historical prose more prone to false-positive matches for these
two, e.g. discussing a completely different variety's method in passing).
`needs_thinning` additionally checks `growing_information` given the
meaningfully wider coverage that gets.

Run from data/: uv run python -m etl.backfill_sowing_details
"""

import json
import re

from etl.config import PLANTS_OUT_DIR

_INDOORS_RE = re.compile(r"\bindoors?\b", re.IGNORECASE)
_DIRECT_RE = re.compile(r"\bdirect\s*(?:seed|sow)", re.IGNORECASE)
_THIN_RE = re.compile(r"\bthin(?:ning|ned)?\b", re.IGNORECASE)


def derive_sowing_details(data: dict) -> dict:
    """Returns only the keys that should be set (never overwrites an
    existing value - see main()'s per-key idempotency check)."""
    sowing_method = data.get("sowing_method") or ""
    growing_info_text = " ".join(e.get("text", "") for e in (data.get("growing_information") or []))

    result: dict = {}
    if _INDOORS_RE.search(sowing_method):
        result["sow_indoors"] = True
    if _DIRECT_RE.search(sowing_method):
        result["sow_direct"] = True
    if _THIN_RE.search(sowing_method) or _THIN_RE.search(growing_info_text):
        result["needs_thinning"] = True
    return result


def main() -> None:
    changed_plants = 0
    changed_fields = 0

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        derived = derive_sowing_details(data)
        # Idempotent per-field, not per-plant - a plant already carrying
        # one of these three (e.g. from a manual edit) keeps that value;
        # only genuinely-missing keys get filled in.
        new_keys = {k: v for k, v in derived.items() if data.get(k) is None}
        if not new_keys:
            continue

        data.update(new_keys)
        data.setdefault("data_sources", []).append(
            {
                "attribution": "manual-sowing-details-derivation",
                "notes": (
                    f"{sorted(new_keys)} derived from explicit keyword matches in sowing_method"
                    + (" and growing_information" if "needs_thinning" in new_keys else "")
                    + " - see GitHub issue #177 / etl/backfill_sowing_details.py."
                ),
            }
        )
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        changed_plants += 1
        changed_fields += len(new_keys)

    print(f"[backfill_sowing_details] done: {changed_fields} field(s) set across {changed_plants} plant(s)")


if __name__ == "__main__":
    main()
