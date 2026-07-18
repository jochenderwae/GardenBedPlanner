"""Rate-limited, disk-cached HTTP fetching shared by every source module.

Caching means a crashed/interrupted run never re-fetches something it
already has - re-running the pipeline is always safe (requirement 6). The
rate limiter is the hard guarantee against hammering a source; see
etl/README.md for why interleaving alone isn't relied on for that.
"""

import json
import time
from pathlib import Path

import httpx

from etl.config import CACHE_DIR

_USER_AGENT = "GardenBedPlanner-ETL/0.1 (+https://github.com/jochenderwae/GardenBedPlanner; personal/hobby project, low volume)"


class RateLimiter:
    """Per-source minimum interval between requests. Not shared across
    sources on purpose - each source's limit is its own."""

    def __init__(self, min_interval_seconds: float):
        self.min_interval_seconds = min_interval_seconds
        self._last_call: float | None = None

    def wait(self) -> None:
        if self._last_call is not None:
            elapsed = time.monotonic() - self._last_call
            remaining = self.min_interval_seconds - elapsed
            if remaining > 0:
                time.sleep(remaining)
        self._last_call = time.monotonic()


def _cache_path(source: str, cache_key: str, ext: str) -> Path:
    safe_key = cache_key.replace("/", "_").replace(":", "_")
    d = CACHE_DIR / source
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{safe_key}.{ext}"


def fetch_json(
    url: str,
    *,
    source: str,
    cache_key: str,
    limiter: RateLimiter,
    params: dict | None = None,
    headers: dict | None = None,
    max_retries: int = 4,
) -> dict | list:
    path = _cache_path(source, cache_key, "json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    data = _get_with_retries(
        url, source=source, limiter=limiter, params=params, headers=headers,
        max_retries=max_retries,
    ).json()
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def fetch_text(
    url: str,
    *,
    source: str,
    cache_key: str,
    limiter: RateLimiter,
    params: dict | None = None,
    headers: dict | None = None,
    max_retries: int = 4,
) -> str:
    path = _cache_path(source, cache_key, "txt")
    if path.exists():
        return path.read_text(encoding="utf-8")

    text = _get_with_retries(
        url, source=source, limiter=limiter, params=params, headers=headers,
        max_retries=max_retries,
    ).text
    path.write_text(text, encoding="utf-8")
    return text


def _get_with_retries(
    url: str,
    *,
    source: str,
    limiter: RateLimiter,
    params: dict | None,
    headers: dict | None,
    max_retries: int,
) -> httpx.Response:
    all_headers = {"User-Agent": _USER_AGENT, **(headers or {})}
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        limiter.wait()
        try:
            resp = httpx.get(url, params=params, headers=all_headers, timeout=30)
            if resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", 10))
                print(f"[{source}] 429 rate-limited, sleeping {retry_after}s")
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_exc = exc
            backoff = 2**attempt
            print(f"[{source}] fetch failed ({exc!r}), retry {attempt + 1}/{max_retries} in {backoff}s")
            time.sleep(backoff)
    assert last_exc is not None
    raise last_exc
