"""openfarm-crops-rescue: primary master-list source (per docs/domain-model.md,
this is the explicit starting point). One JSON array, 340 records, CC0-1.0."""

from etl.http_client import RateLimiter, fetch_json
from etl.normalize import map_sun_level

SOURCE_NAME = "openfarm-crops-rescue"
SOURCE_URL = "https://github.com/thefullnacho/openfarm-crops-rescue"
CROPS_JSON_URL = "https://raw.githubusercontent.com/thefullnacho/openfarm-crops-rescue/master/crops.json"

_limiter = RateLimiter(min_interval_seconds=1.0)

# openfarm-crops-rescue preserved a joke entry from the original OpenFarm.cc
# community wiki verbatim (slug "human-being", sowingMethod: "Love",
# binomialName: "Homosapien") - not a real plant, doesn't belong in a garden
# database, and no amount of data-cleaning makes it valid. Excluded here
# rather than left to fail validation downstream.
_EXCLUDED_SLUGS = {"human-being"}


def fetch_all() -> list[dict]:
    """Returns raw crop dicts as openfarm provides them (not yet mapped to
    our field names - see map_record)."""
    data = fetch_json(
        CROPS_JSON_URL, source=SOURCE_NAME, cache_key="crops", limiter=_limiter
    )
    assert isinstance(data, list)
    return [rec for rec in data if rec.get("slug") not in _EXCLUDED_SLUGS]


def map_record(raw: dict) -> dict:
    """openfarm's field names -> ours. Only includes keys openfarm actually
    had data for (missing != null - the merge stage needs to tell those apart)."""
    out: dict = {
        "slug": raw["slug"],
        "common_name": raw["name"],
    }
    if raw.get("binomialName"):
        out["botanical_name"] = raw["binomialName"]
    if raw.get("description"):
        out["description"] = raw["description"]
    if raw.get("sowingMethod"):
        out["sowing_method"] = raw["sowingMethod"]
    # 0 shows up in a handful of records (e.g. joke/junk entries) but isn't
    # a physically meaningful measurement for a living plant - our schema's
    # exclusiveMinimum: 0 correctly rejects it, so treat it as "no data"
    # here rather than let it flow through to a validation failure later.
    if raw.get("spreadCm"):
        out["spread_cm"] = raw["spreadCm"]
    if raw.get("rowSpacingCm"):
        out["row_spacing_cm"] = raw["rowSpacingCm"]
    if raw.get("heightCm"):
        out["height_cm"] = raw["heightCm"]
    sun = map_sun_level(raw.get("sun"))
    if sun:
        out["sun_level"] = sun

    if raw.get("companions"):
        # openfarm doesn't indicate polarity - a plain "companions" list is
        # conventionally the good pairings, but that's an assumption, not
        # fact from the source. Flagged in the note rather than asserted
        # silently.
        out["companions"] = [
            {
                "companion_slug": c,
                "relationship": "good",
                "notes": "openfarm-crops-rescue lists this as a companion without indicating polarity; assumed 'good' per common convention",
            }
            for c in raw["companions"]
        ]

    out["_source_url"] = raw.get("source", {}).get("waybackUrl") or SOURCE_URL
    return out
