"""Trefle: enrichment, same shape as permapeople.py. is_configured() gates
every call site so the pipeline skips this source cleanly if TREFLE_TOKEN
is ever unset. 120 req/min documented limit."""

import json

import httpx

from etl.config import settings
from etl.http_client import RateLimiter, _cache_path
from etl.normalize import sun_level_from_light_scale

SOURCE_NAME = "trefle"
SOURCE_URL = "https://trefle.io"
BASE_URL = "https://trefle.io/api/v1"

_limiter = RateLimiter(min_interval_seconds=0.55)  # 120/min = 0.5s; slight margin


def is_configured() -> bool:
    return bool(settings.trefle_token)


def search(query: str) -> list[dict]:
    _limiter.wait()
    resp = httpx.get(
        f"{BASE_URL}/plants/search",
        params={"token": settings.trefle_token, "q": query},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def fetch_for_slug(slug: str, common_name: str, botanical_name: str | None) -> dict | None:
    path = _cache_path(SOURCE_NAME, slug, "json")
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw or None

    query = botanical_name or common_name
    results = search(query)
    best = results[0] if results else None
    if best and best.get("id"):
        # search results are summaries; fetch the full record for the
        # cultivation-data fields (sowing, spread, ph, temperature, ...)
        _limiter.wait()
        resp = httpx.get(
            f"{BASE_URL}/plants/{best['id']}",
            params={"token": settings.trefle_token},
            timeout=30,
        )
        resp.raise_for_status()
        best = resp.json().get("data")
    path.write_text(json.dumps(best), encoding="utf-8")
    return best


def map_record(raw: dict) -> dict:
    # Verified against a real /api/v1/plants/<id> response (see
    # data/.cache/trefle/*.json): family/genus/growth/edible* all live
    # under main_species, not at the top level - the top-level "genus"/
    # "family" keys are link-summary objects ({id, name, slug, links}),
    # not the plain strings they look like. Earlier draft of this function
    # read those directly and crashed schema validation the first time it
    # ran for real; fixed here, keeping the note as a warning not to
    # reintroduce the mistake.
    out: dict = {}
    if raw.get("scientific_name"):
        out["botanical_name"] = raw["scientific_name"]

    main_species = raw.get("main_species") or {}
    if main_species.get("family"):
        out["family"] = main_species["family"]
    if main_species.get("genus"):
        out["genus"] = main_species["genus"]
    if main_species.get("edible") is not None:
        out["is_edible"] = main_species["edible"]
    edible_part = main_species.get("edible_part")
    if edible_part:
        out["edible_parts"] = edible_part if isinstance(edible_part, list) else [edible_part]

    growth = main_species.get("growth") or {}
    if growth.get("light") is not None:
        mapped = sun_level_from_light_scale(growth["light"])
        if mapped:
            out["sun_level"] = mapped
    if (growth.get("minimum_temperature") or {}).get("deg_c") is not None:
        out["min_temperature_c"] = growth["minimum_temperature"]["deg_c"]
    if (growth.get("maximum_temperature") or {}).get("deg_c") is not None:
        out["max_temperature_c"] = growth["maximum_temperature"]["deg_c"]
    if growth.get("ph_minimum") is not None:
        out["soil_ph_min"] = growth["ph_minimum"]
    if growth.get("ph_maximum") is not None:
        out["soil_ph_max"] = growth["ph_maximum"]
    if growth.get("days_to_harvest") is not None:
        out["days_to_maturity"] = growth["days_to_harvest"]
    if (growth.get("row_spacing") or {}).get("cm") is not None:
        out["row_spacing_cm"] = growth["row_spacing"]["cm"]
    if (growth.get("spread") or {}).get("cm") is not None:
        out["spread_cm"] = growth["spread"]["cm"]

    out["_source_url"] = f"{SOURCE_URL}/species/{raw.get('slug', '')}"
    return out
