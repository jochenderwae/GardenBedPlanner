"""openfarm-crops-rescue: primary master-list source (per docs/domain-model.md,
this is the explicit starting point). One JSON array, 340 records, CC0-1.0."""

from etl.http_client import RateLimiter, fetch_json
from etl.normalize import map_sun_level

SOURCE_NAME = "openfarm-crops-rescue"
SOURCE_URL = "https://github.com/thefullnacho/openfarm-crops-rescue"
CROPS_JSON_URL = "https://raw.githubusercontent.com/thefullnacho/openfarm-crops-rescue/master/crops.json"

_limiter = RateLimiter(min_interval_seconds=1.0)


def fetch_all() -> list[dict]:
    """Returns raw crop dicts as openfarm provides them (not yet mapped to
    our field names - see map_record)."""
    data = fetch_json(
        CROPS_JSON_URL, source=SOURCE_NAME, cache_key="crops", limiter=_limiter
    )
    assert isinstance(data, list)
    return data


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
    if raw.get("spreadCm") is not None:
        out["spread_cm"] = raw["spreadCm"]
    if raw.get("rowSpacingCm") is not None:
        out["row_spacing_cm"] = raw["rowSpacingCm"]
    if raw.get("heightCm") is not None:
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
