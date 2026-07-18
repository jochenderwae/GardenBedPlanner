"""Value-level normalization: mapping a source's native vocabulary/units
onto our schema's enums and units. Kept separate from matching.py (which is
about plant *identity*, not field values)."""

import re

_SUN_MAP = {
    "full sun": "full_sun",
    "full": "full_sun",
    "part sun": "half_sun",
    "partial sun": "half_sun",
    "part shade": "half_sun",
    "partial shade": "half_sun",
    "half": "half_sun",
    "full shade": "shadow",
    "shade": "shadow",
}


def map_sun_level(text: str | None) -> str | None:
    if not text:
        return None
    return _SUN_MAP.get(text.strip().lower())


def sun_level_from_light_scale(value: float | None) -> str | None:
    """Trefle's 0-10 light scale -> our 3-value enum. Rough banding, not a
    precise conversion - flagged as a conflict candidate like everything
    else, so Ollama sees it alongside other sources' values rather than
    silently overwriting them."""
    if value is None:
        return None
    if value >= 7:
        return "full_sun"
    if value >= 4:
        return "half_sun"
    return "shadow"


_INCHES_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:\"|in|inch)")
_INCHES_SINGLE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:\"|in|inch)")


def parse_spacing_to_cm(text: str | None) -> float | None:
    """Best-effort: '24-36\" apart' -> average of 24/36 in inches -> cm.
    Returns None (not a guess) if the pattern isn't recognized - better to
    have no candidate value than a silently wrong one."""
    if not text:
        return None
    m = _INCHES_RANGE_RE.search(text)
    if m:
        low, high = float(m.group(1)), float(m.group(2))
        return round((low + high) / 2 * 2.54, 1)
    m = _INCHES_SINGLE_RE.search(text)
    if m:
        return round(float(m.group(1)) * 2.54, 1)
    return None
