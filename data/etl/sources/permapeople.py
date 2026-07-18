"""Permapeople: enrichment only, queried per-plant via search (its catalog
is far broader than home-garden crops, so we look up master-list plants by
name rather than bulk-enumerating). Real credentials are in .env."""

import json

import httpx

from etl.config import settings
from etl.http_client import RateLimiter, _cache_path
from etl.normalize import map_sun_level

SOURCE_NAME = "permapeople"
SOURCE_URL = "https://permapeople.org"
SEARCH_URL = "https://permapeople.org/api/search"

# Documented rate limit unknown; conservative default.
_limiter = RateLimiter(min_interval_seconds=1.5)


def is_configured() -> bool:
    return bool(settings.permapeople_key_id and settings.permapeople_key_secret)


def _headers() -> dict:
    return {
        "x-permapeople-key-id": settings.permapeople_key_id or "",
        "x-permapeople-key-secret": settings.permapeople_key_secret or "",
    }


def search(query: str) -> list[dict]:
    """fetch_json's GET-only helper doesn't fit this POST endpoint, so this
    bypasses the cache-and-retry wrapper deliberately - each query is
    already keyed by plant slug at the call site for caching purposes."""
    _limiter.wait()
    resp = httpx.post(
        SEARCH_URL,
        json={"q": query, "type": "Plant", "page": 1, "per_page": 5},
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("plants", [])


def fetch_for_slug(slug: str, common_name: str, botanical_name: str | None) -> dict | None:
    """Cached by slug (not raw query) so re-runs don't re-hit the API."""
    path = _cache_path(SOURCE_NAME, slug, "json")
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw or None

    query = botanical_name or common_name
    results = search(query)
    best = results[0] if results else None
    path.write_text(json.dumps(best), encoding="utf-8")
    return best


def map_record(raw: dict) -> dict:
    out: dict = {}
    if raw.get("scientific_name"):
        out["botanical_name"] = raw["scientific_name"]
    if raw.get("description"):
        out["description"] = raw["description"]

    data_kv = {d["key"]: d["value"] for d in raw.get("data", []) if "key" in d}

    if "Family" in data_kv:
        out["family"] = data_kv["Family"]
    if "Soil type" in data_kv:
        out["soil_type"] = data_kv["Soil type"]
    if "Water requirement" in data_kv:
        out["water_needs"] = data_kv["Water requirement"]
    if "Light requirement" in data_kv:
        for part in data_kv["Light requirement"].split(","):
            mapped = map_sun_level(part)
            if mapped:
                out["sun_level"] = mapped
                break
    if "Edible" in data_kv:
        out["is_edible"] = data_kv["Edible"].strip().lower() == "true"
    if "Edible parts" in data_kv:
        out["edible_parts"] = [p.strip().lower() for p in data_kv["Edible parts"].split(",") if p.strip()]

    out["_source_url"] = raw.get("link") and f"{SOURCE_URL}{raw['link']}" or SOURCE_URL
    return out
