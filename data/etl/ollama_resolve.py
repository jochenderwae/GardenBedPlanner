"""Stage 3: local Ollama resolves fields where multiple sources disagree.

Model choice - mistral-small:latest (23.6B, "tools" capability): of the
models installed locally, this and gpt-oss:20b are the two best suited for
"pick/synthesize one value from several structured candidates, output
strict JSON" - the task needs reliable instruction-following and JSON
adherence far more than broad world knowledge (the candidates are already
given; the model isn't recalling facts from scratch). qwen3.6:latest (36B)
would likely do even better but is meaningfully slower; since the run
budget is generous ("as long as it doesn't take more than a week") this is
a reasonable default but easy to change - see config.py's ollama_model
setting, or override with the OLLAMA_MODEL env var.

Every resolution (and its reasoning) is appended to conflicts_log.jsonl -
requirement 3's "store all values, don't discard" applies here as an audit
trail even though the final export only keeps the resolved value.
"""

import json
from datetime import datetime, timezone

import httpx

from etl.config import DATA_DIR, settings

CONFLICTS_LOG = DATA_DIR / "conflicts_log.jsonl"

_FIELD_HINTS = {
    "description": "A short factual description of the plant.",
    "sowing_method": "How the seed/plant is started, e.g. 'direct sow' or 'start indoors, transplant after hardening off'.",
    "spread_cm": "Mature lateral spread in centimeters. Numeric.",
    "row_spacing_cm": "Spacing between rows in centimeters. Numeric.",
    "height_cm": "Mature height in centimeters. Numeric.",
    "sun_level": "One of exactly: full_sun, half_sun, shadow.",
    "soil_type": "Preferred soil type/texture, short phrase.",
    "composting_needs": "Composting requirements, short phrase.",
    "fertilizer_needs": "Fertilizing requirements, short phrase.",
    "needs_wind_cover": "true/false - whether the plant needs wind protection.",
    "needs_rain_cover": "true/false - whether the plant needs rain protection.",
    "water_needs": "Watering requirements, short phrase.",
    "family": "Taxonomic family name, e.g. 'Solanaceae'.",
    "genus": "Taxonomic genus name, e.g. 'Solanum'.",
    "min_temperature_c": "Minimum tolerated temperature in Celsius. Numeric.",
    "max_temperature_c": "Maximum tolerated temperature in Celsius. Numeric.",
    "days_to_maturity": "Days from planting to harvest. Integer.",
    "soil_ph_min": "Minimum tolerated soil pH, 0-14. Numeric.",
    "soil_ph_max": "Maximum tolerated soil pH, 0-14. Numeric.",
    "is_toxic": "true/false - whether the plant is toxic to humans/pets.",
    "toxicity_notes": "Short note on what part is toxic and to whom, if is_toxic.",
    "is_edible": "true/false - whether (part of) the plant is edible.",
    "succession_enabled": "true/false - whether this crop is typically succession-sown.",
    "succession_interval_days": "Days between succession sowings. Integer.",
    "succession_max_sowings": "Max number of succession sowings in a season. Integer.",
}

# Constrains resolved_value's JSON type per field. First real test run
# without this (bare `"resolved_value": {}`, any type accepted) produced
# `{"full_sun": true}` instead of `"full_sun"` for a sun_level conflict -
# an unconstrained schema reads as "produce a structured object" to the
# model, not "produce a single scalar". Every call site must specify one.
_STRING_TYPE = {"type": "string"}
_NUMBER_TYPE = {"type": "number"}
_INTEGER_TYPE = {"type": "integer"}
_BOOLEAN_TYPE = {"type": "boolean"}

_FIELD_VALUE_TYPES = {
    "description": _STRING_TYPE,
    "sowing_method": _STRING_TYPE,
    "spread_cm": _NUMBER_TYPE,
    "row_spacing_cm": _NUMBER_TYPE,
    "height_cm": _NUMBER_TYPE,
    "sun_level": {"enum": ["full_sun", "half_sun", "shadow"]},
    "soil_type": _STRING_TYPE,
    "composting_needs": _STRING_TYPE,
    "fertilizer_needs": _STRING_TYPE,
    "needs_wind_cover": _BOOLEAN_TYPE,
    "needs_rain_cover": _BOOLEAN_TYPE,
    "water_needs": _STRING_TYPE,
    "family": _STRING_TYPE,
    "genus": _STRING_TYPE,
    "min_temperature_c": _NUMBER_TYPE,
    "max_temperature_c": _NUMBER_TYPE,
    "days_to_maturity": _INTEGER_TYPE,
    "soil_ph_min": _NUMBER_TYPE,
    "soil_ph_max": _NUMBER_TYPE,
    "is_toxic": _BOOLEAN_TYPE,
    "toxicity_notes": _STRING_TYPE,
    "is_edible": _BOOLEAN_TYPE,
    "succession_enabled": _BOOLEAN_TYPE,
    "succession_interval_days": _INTEGER_TYPE,
    "succession_max_sowings": _INTEGER_TYPE,
}


def _response_schema(value_type: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "resolved_value": value_type,
            "reasoning": {"type": "string"},
        },
        "required": ["resolved_value", "reasoning"],
    }


def _log_conflict(slug: str, field_name: str, candidates: list[tuple], resolved, reasoning: str) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "slug": slug,
        "field": field_name,
        # requirement 3: every candidate value, source-tagged, joined for
        # a human-readable audit trail even though structured data is above too.
        "candidates_summary": " | ".join(f"{src}: {val!r}" for val, src in candidates),
        "candidates": [{"source": src, "value": val} for val, src in candidates],
        "resolved_value": resolved,
        "reasoning": reasoning,
    }
    with open(CONFLICTS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def resolve_scalar_field(
    slug: str,
    common_name: str,
    botanical_name: str | None,
    field_name: str,
    candidates: list[tuple],  # [(value, source), ...], len >= 2
) -> tuple:
    """Returns (resolved_value, reasoning). Falls back to the
    highest-priority candidate (candidates[0]) with a note if Ollama is
    unreachable or returns something unusable - a conflict must never
    become a crash."""
    hint = _FIELD_HINTS.get(field_name, "")
    candidate_lines = "\n".join(f"- source '{src}': {val!r}" for val, src in candidates)
    prompt = (
        f"You are cleaning up a plant-database record for '{common_name}'"
        f"{f' ({botanical_name})' if botanical_name else ''}.\n"
        f"Field: {field_name}. {hint}\n\n"
        f"These sources disagree or give different information for this field:\n"
        f"{candidate_lines}\n\n"
        "Decide the single best value for this field. If the sources are "
        "complementary rather than contradictory, synthesize a concise "
        "combined value. If they genuinely conflict, prefer the more "
        "specific/plausible one and say why. Respond with JSON only: "
        '{"resolved_value": <value, correctly typed for the field>, "reasoning": "<one sentence>"}.'
    )

    value_type = _FIELD_VALUE_TYPES.get(field_name, _STRING_TYPE)
    try:
        resolved, reasoning = _call_ollama(prompt, _response_schema(value_type))
    except Exception as exc:  # noqa: BLE001 - never let an LLM hiccup abort the run
        resolved, reasoning = candidates[0][0], f"Ollama call failed ({exc!r}), used highest-priority source as fallback"

    _log_conflict(slug, field_name, candidates, resolved, reasoning)
    return resolved, reasoning


def resolve_companion_conflict(
    slug: str, common_name: str, companion_slug: str, entries: list[dict]
) -> tuple[str, str]:
    """entries: list of {relationship, mechanism, notes, _source} for the
    SAME companion_slug with genuinely different `relationship` values.
    Returns (relationship, reasoning)."""
    lines = "\n".join(
        f"- source '{e['_source']}': relationship={e.get('relationship')}, "
        f"mechanism={e.get('mechanism')!r}, notes={e.get('notes')!r}"
        for e in entries
    )
    prompt = (
        f"For companion planting between '{common_name}' and '{companion_slug}', "
        f"sources disagree on whether this is a good or bad pairing:\n{lines}\n\n"
        'Respond with JSON only: {"resolved_value": "good" or "bad", "reasoning": "<one sentence>"}.'
    )
    try:
        resolved, reasoning = _call_ollama(prompt, _response_schema({"enum": ["good", "bad"]}))
        if resolved not in ("good", "bad"):
            raise ValueError(f"unexpected value {resolved!r}")
    except Exception as exc:  # noqa: BLE001
        resolved, reasoning = entries[0].get("relationship"), f"Ollama call failed ({exc!r}), used first source"

    _log_conflict(
        slug, f"companion:{companion_slug}",
        [(e.get("relationship"), e["_source"]) for e in entries],
        resolved, reasoning,
    )
    return resolved, reasoning


def _call_ollama(prompt: str, response_schema: dict) -> tuple:
    resp = httpx.post(
        f"{settings.ollama_host}/api/generate",
        json={
            "model": settings.ollama_model,
            "prompt": prompt,
            "format": response_schema,
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=180,
    )
    resp.raise_for_status()
    body = resp.json()
    parsed = json.loads(body["response"])
    return parsed["resolved_value"], parsed.get("reasoning", "")
