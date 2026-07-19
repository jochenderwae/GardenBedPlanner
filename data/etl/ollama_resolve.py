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


def infer_botanical_name(slug: str, common_name: str, description: str | None) -> tuple[str | None, str]:
    """Fallback for when NO source has a botanical_name at all (happened for
    ~30 openfarm cultivars - mostly heirloom/regional varieties like
    "Huakaroro Taewa Potato" that Permapeople/Trefle don't have entries for
    either). botanical_name is required by our schema (matches the
    non-nullable Postgres column), so these would otherwise never export.

    Deliberately conservative: asks for null rather than a guess when not
    confident, since a wrong scientific name is worse than a missing one.
    Every inferred value is logged to conflicts_log.jsonl and the resulting
    plant's data_sources gets an "ollama-inference" entry making clear this
    wasn't sourced from an external database - not silently presented as
    equally reliable as a real source."""
    prompt = (
        f"What is the scientific (binomial) botanical name for the garden plant "
        f"commonly called '{common_name}'?"
        + (f" Additional context: {description}" if description else "")
        + "\nThis is likely a specific cultivar/variety name (e.g. a named potato or "
        "tomato variety) - give the binomial name for the species it belongs to "
        "(e.g. 'Solanum tuberosum' for any potato variety, regardless of cultivar). "
        "If you are not reasonably confident, respond with null rather than "
        'guessing. Respond with JSON only: {"resolved_value": "<Genus species>" '
        'or null, "reasoning": "<one sentence>"}.'
    )
    try:
        resolved, reasoning = _call_ollama(
            prompt, _response_schema({"type": ["string", "null"]})
        )
    except Exception as exc:  # noqa: BLE001
        resolved, reasoning = None, f"Ollama call failed ({exc!r})"

    _log_conflict(slug, "botanical_name (inferred, no source had one)", [], resolved, reasoning)
    return resolved, reasoning


_GROWTH_HABIT_DESCRIPTIONS = {
    "upright": (
        "grows as an upright clump or bush from the ground, taller than wide; "
        "no vining/climbing habit and no flat ground-hugging rosette (most "
        "vegetables, upright herbs, alliums, grasses/corn)"
    ),
    "spreading": (
        "low, wide, mounding, or ground-covering growth that spreads outward "
        "from its base without a trunk or climbing structure - a woody bush/"
        "subshrub (currant, gooseberry, blueberry, sage, thyme, rosemary), or "
        "a trailing/sprawling plant that spreads across the soil rather than "
        "climbing (strawberry runners, sweet potato, ground-grown winter "
        "squash)"
    ),
    "climbing": (
        "a vine that needs a trellis/support/fence to grow upward (peas, "
        "pole beans, cucumbers when trellised, grapes, hops, kiwi)"
    ),
    "rosette": (
        "leaves radiate from a central point at/near ground level in a flat "
        "rosette, often with the harvestable/storage part underground (root "
        "vegetables like carrot/beet/radish, and rosette-forming leafy "
        "greens like lettuce/spinach)"
    ),
    "tree": "a single-trunk woody tree with a canopy well above ground level",
}


def infer_growth_habit(
    slug: str,
    common_name: str,
    botanical_name: str | None,
    family: str | None,
    description: str | None,
    growing_info_excerpt: str | None,
    allowed_categories: list[str],
    trefle_signal: str | None = None,
) -> tuple[str | None, str]:
    """Infers this project's own growth_habit rendering category (see
    plant.schema.json - NOT a copy of Trefle's own raw growth_habit string)
    for plants Trefle's cached data can't confidently place on its own -
    see populate_growth_habit.py, which calls this for (a) plants with no
    Trefle growth_habit data at all, and (b) plants whose Trefle
    growth_habit is bare 'Forb/herb', genuinely ambiguous between
    upright/rosette/spreading (confirmed against real cached data: tomato/
    basil/garlic/sunflower are 'Forb/herb' and clearly upright; carrot/beet/
    lettuce/spinach are 'Forb/herb' and clearly rosette; strawberry is
    'Forb/herb' and clearly spreading).

    allowed_categories narrows the choice when Trefle has already ruled some
    categories out (e.g. bare 'Forb/herb' rules out tree/climbing) - always
    a subset of the 5-category set in plant.schema.json. Deliberately
    conservative like infer_botanical_name: returns (None, reasoning)
    rather than a guess when not confident, so the caller can log it to
    growth_habit_unmatched.jsonl instead of writing a wrong value."""
    options_text = "\n".join(
        f"- '{cat}': {_GROWTH_HABIT_DESCRIPTIONS[cat]}" for cat in allowed_categories
    )
    context_lines = [f"Common name: {common_name}"]
    if botanical_name:
        context_lines.append(f"Botanical name: {botanical_name}")
    if family:
        context_lines.append(f"Family: {family}")
    if description:
        context_lines.append(f"Description: {description[:500]}")
    if growing_info_excerpt:
        context_lines.append(f"Growing information excerpt: {growing_info_excerpt}")
    if trefle_signal:
        context_lines.append(
            f"Note: a structured plant database already says this plant's raw "
            f"growth habit is {trefle_signal!r} - herbaceous (not woody, not a "
            "tree), which already rules out tree/climbing, but isn't specific "
            "enough on its own to know which of the remaining options fits."
        )

    prompt = (
        "You are categorizing a garden plant's overall growth shape for a "
        "garden-bed layout editor, so it can be drawn with a visual "
        "treatment that matches its real shape (climbing vine vs. tree vs. "
        "low spreading bush vs. upright clump vs. ground-hugging rosette), "
        "instead of a generic circle.\n\n"
        + "\n".join(context_lines)
        + "\n\nChoose exactly one of these categories:\n"
        + options_text
        + "\n\nIf you are not reasonably confident which one fits, respond "
        'with null rather than guessing. Respond with JSON only: '
        '{"resolved_value": "<category>" or null, "reasoning": "<one sentence>"}.'
    )
    value_type = {"enum": [*allowed_categories, None]}
    try:
        resolved, reasoning = _call_ollama(prompt, _response_schema(value_type))
        if resolved is not None and resolved not in allowed_categories:
            resolved, reasoning = (
                None,
                f"Ollama returned {resolved!r}, not one of the allowed categories - treated as unmatched",
            )
    except Exception as exc:  # noqa: BLE001 - never let an LLM hiccup abort the run
        resolved, reasoning = None, f"Ollama call failed ({exc!r})"

    _log_conflict(slug, "growth_habit (inferred)", [], resolved, reasoning)
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
