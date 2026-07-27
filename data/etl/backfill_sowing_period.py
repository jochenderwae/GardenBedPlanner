"""One-off backfill for GitHub issue #153: derive a `sowing`-type `periods`
entry from `sowing_method` text, for plants that have the former but not
the latter (e.g. celery.json: sowing_method says "Sow seeds indoors 10-12
weeks before transplanting outdoors" but periods only has planting/
fertilizing entries).

Deliberately conservative, matching plant.schema.json's own periods
description ("omit a period entirely rather than guessing start/end"):
only derives a window when BOTH of these hold, everything else is logged
unmatched rather than guessed -

1. `sowing_method` contains an explicit "N (or N-M) weeks before <phrase>"
   lead time (most sowing_method values are HOW-to-sow instructions with
   no timing info at all - "Direct seed outdoors after last frost" gives
   no anchor to compute from, however true that folk-gardening advice is).
2. The plant already has an existing period this lead time can be measured
   backward from. Two <phrase> categories map to the existing 'planting'
   period type:
   - "before transplanting"/"before planting (out/outdoors)" - the literal,
     unambiguous case.
   - "before last frost" - not literally the same phrase, but for the
     tender/warm-season crops that actually use this phrasing (eggplant
     seen in practice), "transplant outdoors after the last frost" is such
     standard, near-universal gardening convention that a plant's own
     recorded 'planting' period IS effectively its last-frost-anchored
     transplant window. This is a documented judgment call (see GitHub
     issue #153's discussion), not a blind guess: it never invents a frost
     date, it only ever uses THIS plant's own already-recorded 'planting'
     period as the anchor, and only when that period actually exists.

Sowing window is computed by subtracting the lead time (converted from
weeks to months, ~4.348 weeks/month) from the anchor period's start/end
months, using the widest lead (longest lead time from the anchor's
earliest month) for the sowing window's start and the narrowest lead
(shortest lead time from the anchor's latest month) for its end - i.e. the
full range of possible sow dates implied by the anchor period range and
the stated lead-time range.

Run from data/: uv run python -m etl.backfill_sowing_period
"""

import json
import re

from etl.config import DATA_DIR, PLANTS_OUT_DIR

UNMATCHED_LOG = DATA_DIR / "sowing_period_backfill_unmatched.jsonl"

_WEEKS_PER_MONTH = 4.348

_LEAD_TIME_RE = re.compile(
    r"(?P<min>\d+)(?:\s*-\s*(?P<max>\d+))?\s*weeks?\s+before\s+(?P<phrase>[a-zA-Z][a-zA-Z \-]*)",
    re.IGNORECASE,
)


def _classify_anchor(phrase: str) -> str | None:
    phrase = phrase.strip().lower()
    if "transplant" in phrase or "planting" in phrase:
        return "planting"
    if "frost" in phrase:
        # See module docstring: "before last frost" is treated as
        # equivalent to this plant's own 'planting' period, not a fixed
        # calendar date - only used when that period already exists.
        return "planting"
    return None


def _weeks_to_months(weeks: float) -> int:
    return round(weeks / _WEEKS_PER_MONTH)


def _subtract_months(month: int, offset: int) -> int:
    return ((month - offset - 1) % 12) + 1


def derive_sowing_period(data: dict) -> tuple[dict | None, str | None]:
    """Returns (new period dict or None, unmatched reason or None) for a
    single plant. Never mutates `data`."""
    sowing_method = data.get("sowing_method")
    if not sowing_method:
        return None, None  # nothing to derive from - not an error, just skip

    match = _LEAD_TIME_RE.search(sowing_method)
    if not match:
        return None, "no explicit 'N weeks before X' lead time in sowing_method"

    lead_min = int(match.group("min"))
    lead_max = int(match.group("max")) if match.group("max") else lead_min
    anchor_type = _classify_anchor(match.group("phrase"))
    if anchor_type is None:
        return None, f"lead-time phrase {match.group('phrase')!r} doesn't map to a known anchor period type"

    anchor = next((p for p in data.get("periods", []) if p.get("period_type") == anchor_type), None)
    if anchor is None:
        return None, f"no existing {anchor_type!r} period to anchor the lead time against"

    lead_min_months = _weeks_to_months(lead_min)
    lead_max_months = _weeks_to_months(lead_max)
    start_month = _subtract_months(anchor["start_month"], lead_max_months)
    end_month = _subtract_months(anchor["end_month"], lead_min_months)
    return {"period_type": "sowing", "start_month": start_month, "end_month": end_month}, None


def main() -> None:
    changed = 0
    unmatched: list[dict] = []

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if any(p.get("period_type") == "sowing" for p in data.get("periods", [])):
            continue  # idempotent - already has a sowing period

        new_period, reason = derive_sowing_period(data)
        if reason:
            unmatched.append({"slug": data["slug"], "sowing_method": data.get("sowing_method"), "reason": reason})
            continue
        if new_period is None:
            continue  # no sowing_method at all - nothing to log, nothing to do

        data.setdefault("periods", []).append(new_period)
        data.setdefault("data_sources", []).append(
            {
                "attribution": "manual-sowing-period-derivation",
                "notes": (
                    f"sowing period (month {new_period['start_month']}-{new_period['end_month']}) derived "
                    f"from sowing_method ({data['sowing_method']!r}) and this plant's own existing planting "
                    "period - see etl/backfill_sowing_period.py's module docstring for the derivation logic "
                    "(GitHub issue #153)."
                ),
            }
        )
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[backfill_sowing_period] {data['slug']}: sowing period {new_period['start_month']}-{new_period['end_month']} added")
        changed += 1

    if unmatched:
        with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
            for entry in unmatched:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"[backfill_sowing_period] {len(unmatched)} plant(s) with sowing_method couldn't be confidently resolved - logged to {UNMATCHED_LOG}")

    print(f"[backfill_sowing_period] done: {changed} plant(s) given a new sowing period")


if __name__ == "__main__":
    main()
