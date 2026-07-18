"""Homesteader Labs' Crop Knowledge Base: secondary master-list source (adds
crops openfarm doesn't have) + a richer companion-planting file with
mechanism/notes that openfarm's flat slug list lacks."""

from etl.http_client import RateLimiter, fetch_json
from etl.normalize import map_sun_level, parse_spacing_to_cm

SOURCE_NAME = "homesteader-labs"
SOURCE_URL = "https://github.com/thefullnacho/homesteader-labs-next/tree/master/content/crops"
_BASE = "https://raw.githubusercontent.com/thefullnacho/homesteader-labs-next/master/content/crops"

CROP_FILES = ["vegetables.json", "herbs.json", "fruits-annual.json", "fruits-perennial.json"]
COMPANION_FILE = "companion-planting.json"
PEST_COMPANION_FILE = "pest-companions.json"

_limiter = RateLimiter(min_interval_seconds=1.0)


def fetch_crop_file(filename: str) -> list[dict]:
    data = fetch_json(
        f"{_BASE}/{filename}",
        source=SOURCE_NAME,
        cache_key=filename.removesuffix(".json"),
        limiter=_limiter,
    )
    return data if isinstance(data, list) else []


def fetch_companion_file() -> list[dict]:
    data = fetch_json(
        f"{_BASE}/{COMPANION_FILE}",
        source=SOURCE_NAME,
        cache_key="companion-planting",
        limiter=_limiter,
    )
    return data if isinstance(data, list) else []


def fetch_pest_companion_file() -> list[dict]:
    """Structure unverified (unlike the others) - best-effort only, never
    raises. Returns [] if the shape doesn't match what we expect."""
    try:
        data = fetch_json(
            f"{_BASE}/{PEST_COMPANION_FILE}",
            source=SOURCE_NAME,
            cache_key="pest-companions",
            limiter=_limiter,
        )
        return data if isinstance(data, list) else []
    except Exception as exc:  # noqa: BLE001 - deliberately broad, this file is a bonus
        print(f"[{SOURCE_NAME}] pest-companions.json fetch/parse failed, skipping: {exc!r}")
        return []


def map_crop_record(raw: dict) -> dict:
    out: dict = {
        "slug": raw["id"],
        "common_name": raw["name"],
    }
    if raw.get("binomialName"):
        out["botanical_name"] = raw["binomialName"]
    if raw.get("description"):
        out["description"] = raw["description"]
    sun = map_sun_level(raw.get("sun"))
    if sun:
        out["sun_level"] = sun
    spacing_cm = parse_spacing_to_cm(raw.get("spacing"))
    if spacing_cm:
        out["row_spacing_cm"] = spacing_cm
    if raw.get("daysToMaturity") is not None:
        out["days_to_maturity"] = raw["daysToMaturity"]
    if raw.get("waterNeedsPerWeek") is not None:
        out["water_needs"] = f"~{raw['waterNeedsPerWeek']} in/week"

    if raw.get("successionEnabled") is not None:
        out["succession_enabled"] = raw["successionEnabled"]
    if raw.get("successionInterval"):
        out["succession_interval_days"] = raw["successionInterval"]
    if raw.get("successionMax"):
        out["succession_max_sowings"] = raw["successionMax"]

    companions = []
    for c in raw.get("companions", []):
        companions.append({"companion_slug": c, "relationship": "good"})
    for c in raw.get("antagonists", []):
        companions.append({"companion_slug": c, "relationship": "bad"})
    if companions:
        out["companions"] = companions

    if raw.get("pestVulnerabilities"):
        out["pest_interactions"] = [
            {"interaction_type": "vulnerable_to", "pest_or_insect": p}
            for p in raw["pestVulnerabilities"]
        ]

    out["_source_url"] = SOURCE_URL
    return out


def map_companion_relationships(raw: dict) -> tuple[str, list[dict]]:
    """Returns (plant_slug, companions[]) from one companion-planting.json entry."""
    plant_slug = raw["plantId"]
    companions = []
    for rel in raw.get("relationships", []):
        rel_type = rel.get("type")
        relationship = {"companion": "good", "antagonist": "bad"}.get(rel_type)
        if relationship is None:
            continue
        companions.append(
            {
                "companion_slug": rel["targetId"],
                "relationship": relationship,
                "mechanism": rel.get("mechanism"),
                "notes": rel.get("description"),
            }
        )
    return plant_slug, companions
