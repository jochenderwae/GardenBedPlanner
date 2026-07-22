"""The four post-ingestion Ollama passes over a plant's growing_information,
run once all books have been ingested (see run.py). Each pass is
independently checkpointed (etl/growing_info/state.py's plant_pass_done) so
a crash mid-run only redoes whichever pass/plant was in flight.

Model choice: mistral-small:latest for all four passes, same as the rest of
this ETL (ollama_resolve.py, split.py, match.py) - kept uniform rather than
picking a different model per pass. Reasoning: every pass here still needs
strict, reliable JSON-shaped output (even pass 1's "free text" consolidation
is returned as one field inside a JSON envelope, same as every other Ollama
call in this codebase) more than it needs extra world knowledge - the
source material (this plant's own growing_information text) is already
given, not recalled. mistral-small is the one already proven on that axis
here (see ollama_resolve.py's docstring). A stronger prose model
(phi4:14b/gpt-oss:20b) is a plausible upgrade specifically for pass 1's
synthesis quality if a spot check ever shows mistral-small's consolidated
text reading as flat/generic, but wasn't needed to get a working pipeline -
not worth the extra variable during initial build-out.
"""

import json
import re
from datetime import datetime, timezone

import httpx

from etl.config import DATA_DIR, settings
from etl.ollama_resolve import resolve_scalar_field

CROSSCHECK_LOG = DATA_DIR / "growing_info_crosscheck_log.jsonl"
INTERESTING_LOG = DATA_DIR / "growing_info_interesting_log.jsonl"
# issue #120: the consolidate prompt now requires every imperial measurement
# to carry a metric value too, but an LLM instruction isn't a guarantee -
# logged (not silently accepted, not blocked/retried) so a human can spot-
# check whether misses are rare noise or a systematic prompt problem.
IMPERIAL_RESIDUAL_LOG = DATA_DIR / "growing_info_imperial_residual_log.jsonl"
# issue #120 follow-up: found while verifying the metric-units reconsolidation
# run - celery has 9 raw entries (~36k prompt chars, the largest of any
# plant), and its consolidate call hit the Ollama request timeout. The
# exception was caught and printed but never marked_pass_done was still
# called unconditionally in run.py, so celery was silently left with NO
# consolidated entry and no persistent trace (the print landed in a
# detached run's redirected stdout, easy to miss). Now logged persistently
# here, and ConsolidationFailed (below) stops run.py from marking the pass
# done on failure, so a future run_passes retries it instead of losing it.
CONSOLIDATE_FAILURE_LOG = DATA_DIR / "growing_info_consolidate_failure_log.jsonl"

_MAX_TEXT_CHARS = 6000  # per-call prompt budget across the raw entries
# consolidate_pass's own prompt (unlike extract/crosscheck/surface, which
# read the much-shorter _best_text) concatenates ALL raw entries uncapped
# in total - some plants (celery: 9 raw entries, ~36k chars) can take
# noticeably longer than the default 240s to process. Bumped just for this
# call rather than raising the global default, since the other three passes
# never see prompts anywhere near this size.
_CONSOLIDATE_TIMEOUT_SECONDS = 480


class ConsolidationFailed(Exception):
    """Raised by consolidate_pass when the Ollama call itself errors out
    (timeout, bad JSON, connection error, etc.) - distinct from returning
    None for the legitimate "fewer than 2 raw entries, nothing to
    synthesize" case. Callers (run.py) must not mark the consolidate pass
    done when this is raised."""

# Best-effort detector for a leftover imperial-only measurement: a number
# (digits or spelled out) directly followed by an imperial unit word, with
# no metric unit (cm/mm/m/l/kg/g) anywhere nearby. Not a precise parser -
# just enough to flag likely misses for review, same spirit as every other
# "log it, don't guess" heuristic in this pipeline.
_NUMBER_WORD = r"(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)"
_IMPERIAL_RE = re.compile(
    rf"\b{_NUMBER_WORD}(?:\s*(?:to|-|or)\s*{_NUMBER_WORD})?\s*"
    r"(?:inch(?:es)?|foot|feet|ft\.?|yard(?:s)?)\b",
    re.IGNORECASE,
)
_METRIC_NEARBY_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:cm|mm|m|km)\b", re.IGNORECASE)


def _find_imperial_residuals(text: str, window: int = 40) -> list[str]:
    """Returns the surrounding snippet for each imperial-unit mention that
    doesn't have a metric measurement within `window` characters either
    side - a real conversion has both close together (e.g. '30cm (12in)'),
    so a lone imperial mention with no nearby metric value is a likely miss."""
    hits = []
    for m in _IMPERIAL_RE.finditer(text):
        start, end = max(0, m.start() - window), min(len(text), m.end() + window)
        snippet = text[start:end]
        if not _METRIC_NEARBY_RE.search(snippet):
            hits.append(snippet.strip())
    return hits


def _append_log(path, entry: dict) -> None:
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), **entry}
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _call_ollama(prompt: str, schema: dict, *, model: str | None = None, timeout: float = 240) -> dict:
    resp = httpx.post(
        f"{settings.ollama_host}/api/generate",
        json={
            "model": model or settings.ollama_model,
            "prompt": prompt,
            "format": schema,
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return json.loads(resp.json()["response"])


def _raw_entries(plant_json: dict) -> list[dict]:
    return [e for e in plant_json.get("growing_information", []) if e.get("record_type", "raw") == "raw"]


def _best_text(plant_json: dict) -> str:
    """Prefer the consolidated entry (already-synthesized, shorter) if one
    exists; otherwise concatenate raw entries, truncated to a reasonable
    prompt budget."""
    for e in plant_json.get("growing_information", []):
        if e.get("record_type") == "consolidated":
            return e["text"]
    combined = "\n\n---\n\n".join(e["text"] for e in _raw_entries(plant_json))
    return combined[:_MAX_TEXT_CHARS]


# --- Pass 1: consolidate ----------------------------------------------------

def consolidate_pass(plant_json: dict) -> dict | None:
    """Synthesizes this plant's raw growing_information entries (however
    many books mention it) into one `consolidated` entry. Raw entries are
    left untouched alongside it (they're the permanent audit trail - see
    module docstring / spec). Returns the new entry dict to append, or None
    if there's nothing to consolidate (0 or 1 raw entries - a single entry
    has nothing to synthesize; callers may still choose to treat it as
    already-consolidated in that case, see run.py)."""
    raw = _raw_entries(plant_json)
    if len(raw) < 2:
        return None

    sources_text = "\n\n".join(f"[Source: {e.get('attribution', 'unknown')}]\n{e['text'][:_MAX_TEXT_CHARS]}" for e in raw)
    common_name = plant_json.get("common_name", plant_json["slug"])
    prompt = (
        f"Here are {len(raw)} separate old gardening-book excerpts about growing "
        f"'{common_name}':\n\n{sources_text}\n\n"
        "Synthesize these into ONE well-organized paragraph (or a few short "
        "paragraphs) of practical growing advice, combining what's "
        "complementary and not repeating what's redundant. Keep concrete "
        "specifics (spacing, timing, soil, pests) rather than vague "
        "generalities. These old books use imperial measurements "
        "throughout (inches, feet, spelled out as words like 'three or "
        "four inches' as well as digits like '4 ft') - convert EVERY "
        "single one you find, spelled-out or numeric, to metric (cm, m, L, "
        "etc.) as the primary unit, and add the original imperial value in "
        "parentheses afterward, e.g. '30cm (12in) apart', '1.2m (4ft) "
        "between rows', or '7-10cm (three or four inches) high'. Do not "
        "leave any measurement in imperial units only, including ones "
        "spelled out in words rather than digits. Respond with JSON only: "
        '{"consolidated_text": "<the combined text>"}.'
    )
    schema = {
        "type": "object",
        "properties": {"consolidated_text": {"type": "string"}},
        "required": ["consolidated_text"],
    }
    try:
        parsed = _call_ollama(prompt, schema, timeout=_CONSOLIDATE_TIMEOUT_SECONDS)
        text = parsed["consolidated_text"].strip()
    except Exception as exc:  # noqa: BLE001
        slug = plant_json["slug"]
        print(f"[passes] consolidate failed for {slug}: {exc!r}")
        _append_log(
            CONSOLIDATE_FAILURE_LOG,
            {
                "slug": slug,
                "common_name": common_name,
                "num_raw_entries": len(raw),
                "prompt_chars": len(sources_text),
                "error": repr(exc),
            },
        )
        raise ConsolidationFailed(f"{slug}: {exc!r}") from exc
    if not text:
        return None

    residuals = _find_imperial_residuals(text)
    if residuals:
        _append_log(
            IMPERIAL_RESIDUAL_LOG,
            {"slug": plant_json["slug"], "common_name": common_name, "residual_snippets": residuals},
        )

    return {
        "text": text,
        "record_type": "consolidated",
        "attribution": "Ollama synthesis of " + ", ".join(sorted({e.get("attribution", "unknown") for e in raw})),
        "copyright_status": "derived from public-domain sources; synthesis itself not independently copyrighted",
    }


# --- Pass 2: extract ---------------------------------------------------------

# The zero-source-coverage fields per data/CLAUDE.md's "Fields still needing
# a source" - typed per field for the same reason ollama_resolve.py's
# _FIELD_VALUE_TYPES exists (an unconstrained schema gets read as "produce a
# nested object" by the model, not "produce a scalar").
#
# issue #127: broadened beyond that original fixed list to also mine
# growing_information for periods/edible_parts/soil_type/spread_cm/
# row_spacing_cm - fields a STRUCTURED source could in principle cover (and
# for periods, was even documented as covered by Trefle in data/CLAUDE.md's
# source-coverage table - confirmed on inspection that mapping was never
# actually implemented in sources/trefle.py, so every plant's periods list
# is empty regardless of growing_information) but which frequently sit
# empty in practice, and which the old gardening-book text often states
# explicitly (e.g. bell pepper: "sown about the middle of March"; chicory:
# "space plants 30cm (12in) apart in rows that are 90-120cm (3-4ft)").
_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "composting_needs": {"type": ["string", "null"]},
        "fertilizer_needs": {"type": ["string", "null"]},
        "needs_wind_cover": {"type": ["boolean", "null"]},
        "needs_rain_cover": {"type": ["boolean", "null"]},
        "seed_pretreatment": {"type": ["string", "null"]},
        "bedding_needs": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "properties": {
                    "need_type": {"type": "string"},
                    "notes": {"type": ["string", "null"]},
                },
                "required": ["need_type"],
            },
        },
        "soil_type": {"type": ["string", "null"]},
        "spread_cm": {"type": ["number", "null"]},
        "row_spacing_cm": {"type": ["number", "null"]},
        "edible_parts": {"type": ["array", "null"], "items": {"type": "string"}},
        "periods": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "properties": {
                    "period_type": {"type": "string"},
                    "start_month": {"type": ["integer", "null"]},
                    "end_month": {"type": ["integer", "null"]},
                },
                "required": ["period_type", "start_month", "end_month"],
            },
        },
    },
    "required": [
        "composting_needs", "fertilizer_needs", "needs_wind_cover",
        "needs_rain_cover", "seed_pretreatment", "bedding_needs",
        "soil_type", "spread_cm", "row_spacing_cm", "edible_parts", "periods",
    ],
}


def _extract_fields_via_ollama(slug: str, common_name: str, text: str) -> dict:
    prompt = (
        f"Here is old gardening-book text about growing '{common_name}':\n\n{text}\n\n"
        "Extract ONLY what this text actually states (do not guess or infer "
        "beyond what's written) for each of these:\n"
        "- composting_needs: composting requirements, short phrase, or null if not mentioned\n"
        "- fertilizer_needs: fertilizing requirements, short phrase, or null\n"
        "- needs_wind_cover: true/false if the text discusses wind protection/staking against wind, else null\n"
        "- needs_rain_cover: true/false if the text discusses rain/frost protection, else null\n"
        "- seed_pretreatment: seed pretreatment before sowing (e.g. soaking, stratification), or null\n"
        "- bedding_needs: array of {need_type, notes} for hilling/staking/ground-cover/etc mentioned, or null\n"
        "- soil_type: preferred soil type/texture explicitly described (e.g. 'deep, rich loam'), or null\n"
        "- spread_cm: a single representative number in centimeters for how far apart individual "
        "plants should be spaced, ONLY if the text gives a specific measurement (convert imperial "
        "to metric if needed; if a range is given, use the middle of the range), else null\n"
        "- row_spacing_cm: same as spread_cm but for the spacing BETWEEN ROWS specifically "
        "(only if the text distinguishes row spacing from in-row plant spacing), else null\n"
        "- edible_parts: array of short lowercase strings (e.g. 'root', 'leaves', 'fruit', 'flowers', "
        "'seeds') for plant parts the text explicitly describes eating/using as food, or null\n"
        "- periods: array of {period_type, start_month, end_month} for recurring annual timing "
        "windows explicitly stated in the text (month numbers 1-12; for a single month, set "
        "start_month equal to end_month). period_type must be one of exactly: 'sowing', "
        "'planting', 'fertilizing', 'harvesting' - pick whichever this window is actually about. "
        "Only include a period if the text names a specific month or season mapped confidently to "
        "month numbers; do not guess. Return null (or omit) if no such window is stated.\n\n"
        "Respond with JSON only, matching exactly this shape: "
        '{"composting_needs": ..., "fertilizer_needs": ..., "needs_wind_cover": ..., '
        '"needs_rain_cover": ..., "seed_pretreatment": ..., "bedding_needs": ..., '
        '"soil_type": ..., "spread_cm": ..., "row_spacing_cm": ..., "edible_parts": ..., '
        '"periods": ...}.'
    )
    try:
        return _sanitize_extracted(_call_ollama(prompt, _EXTRACT_SCHEMA))
    except Exception as exc:  # noqa: BLE001
        print(f"[passes] extract failed for {slug}: {exc!r}")
        return {}


def _sanitize_extracted(extracted: dict) -> dict:
    """Ollama's structured output for a nullable string field
    (`{"type": ["string", "null"]}`) sometimes emits the literal 3-letter
    JSON token spelled out AS a string value (i.e. the Python string
    "null") instead of actually returning JSON null - caught during
    development via a schema-validation-passing but semantically wrong
    write (golden-beet's composting_needs came back as the four-character
    string "null" rather than being omitted). Same risk for the empty
    string. Normalizes both back to None for every string-typed key here
    before this dict is used for anything."""
    cleaned = dict(extracted)
    for key in ("composting_needs", "fertilizer_needs", "seed_pretreatment", "soil_type"):
        value = cleaned.get(key)
        if isinstance(value, str) and value.strip().lower() in ("null", "none", ""):
            cleaned[key] = None
    # Defensive against out-of-range/malformed period entries slipping past
    # the JSON schema (schema only constrains type, not the 1-12 range) -
    # same "log it, don't guess" spirit as the rest of this module, but a
    # single bad period entry shouldn't sink the whole extraction, so it's
    # just dropped here rather than logged (callers only see valid ones).
    periods = cleaned.get("periods") or []
    valid_periods = []
    for p in periods:
        period_type = p.get("period_type")
        start, end = p.get("start_month"), p.get("end_month")
        if not period_type or not isinstance(start, int) or not isinstance(end, int):
            continue
        if not (1 <= start <= 12 and 1 <= end <= 12):
            continue
        valid_periods.append({"period_type": period_type, "start_month": start, "end_month": end})
    cleaned["periods"] = valid_periods
    return cleaned


def extract_pass(plant_json: dict) -> list[str]:
    """Pass 2. Design decision (spec left this open - see task brief): the
    main ETL run already finished and wrote final data/plants/*.json files,
    so there's no live merge.WorkingRecord to feed extracted candidates
    into. Reconciliation used here: treat whatever value is ALREADY in the
    exported JSON (if any) as one candidate, tagged 'existing-export', and
    the newly extracted value as a second candidate, tagged
    'growing-info-extraction' - then run them through the exact same
    ollama_resolve.resolve_scalar_field used by every other source's
    conflicts, so growing_info text isn't special-cased in HOW conflicts
    get resolved, only in how its candidates get produced. If there's no
    existing value, there's nothing to reconcile - the extracted value is
    written directly (single candidate, no conflict to resolve, matching
    FieldCandidates.is_unambiguous's own "one value = no LLM call needed"
    rule in merge.py). bedding_needs is a list field, not a scalar - list
    fields don't get full LLM resolution anywhere in this codebase (see
    etl/CLAUDE.md's note on merge.py's list-field handling), so extracted
    bedding_needs are unioned by need_type instead, same simpler pattern
    export.py already uses for other list fields.

    issue #127 broadened this same reconciliation to soil_type/spread_cm/
    row_spacing_cm (ordinary scalars - already have _FIELD_HINTS/
    _FIELD_VALUE_TYPES entries in ollama_resolve.py from the main pipeline,
    so they slot into the exact same existing-vs-extracted conflict
    resolution as composting_needs etc. above) plus two more list fields:
    edible_parts (unioned, same need_type-union pattern as bedding_needs -
    there's nothing to key it by since it's just a flat string list, so it's
    a straight set union) and periods (additive-only, keyed by period_type -
    deliberately does NOT overwrite or attempt to resolve a conflict against
    an existing period of the same type, since merge.py's own list-field
    handling never does full LLM resolution for periods either; a period
    only gets added here when that period_type doesn't already exist for
    this plant, so a growing-info-derived guess never silently replaces a
    period a more authoritative structured source already established).
    """
    text = _best_text(plant_json)
    if not text:
        return []

    slug = plant_json["slug"]
    common_name = plant_json.get("common_name", slug)
    extracted = _extract_fields_via_ollama(slug, common_name, text)
    if not extracted:
        return []

    changed: list[str] = []

    for field_name in (
        "composting_needs", "fertilizer_needs", "needs_wind_cover", "needs_rain_cover",
        "soil_type", "spread_cm", "row_spacing_cm",
    ):
        value = extracted.get(field_name)
        if value is None:
            continue
        existing = plant_json.get(field_name)
        if existing == value:
            continue
        if existing is None:
            plant_json[field_name] = value
            changed.append(field_name)
        else:
            resolved, _reasoning = resolve_scalar_field(
                slug, common_name, plant_json.get("botanical_name"), field_name,
                [(existing, "existing-export"), (value, "growing-info-extraction")],
            )
            if resolved != existing:
                plant_json[field_name] = resolved
                changed.append(field_name)

    pretreatment = extracted.get("seed_pretreatment")
    if pretreatment is not None:
        seed_info = plant_json.setdefault("seed_info", {}) or {}
        plant_json["seed_info"] = seed_info
        existing = seed_info.get("pretreatment")
        if existing != pretreatment:
            if existing is None:
                seed_info["pretreatment"] = pretreatment
                changed.append("seed_info.pretreatment")
            else:
                resolved, _reasoning = resolve_scalar_field(
                    slug, common_name, plant_json.get("botanical_name"), "seed_info.pretreatment",
                    [(existing, "existing-export"), (pretreatment, "growing-info-extraction")],
                )
                if resolved != existing:
                    seed_info["pretreatment"] = resolved
                    changed.append("seed_info.pretreatment")

    extracted_bedding = extracted.get("bedding_needs") or []
    if extracted_bedding:
        existing_bedding = plant_json.setdefault("bedding_needs", [])
        existing_types = {b.get("need_type") for b in existing_bedding}
        for need in extracted_bedding:
            if need.get("need_type") in existing_types:
                continue
            existing_bedding.append(need)
            existing_types.add(need.get("need_type"))
            changed.append("bedding_needs")

    extracted_edible_parts = extracted.get("edible_parts") or []
    if extracted_edible_parts:
        existing_parts = set(plant_json.get("edible_parts") or [])
        merged_parts = existing_parts | {p.strip().lower() for p in extracted_edible_parts if p and p.strip()}
        if merged_parts != existing_parts:
            plant_json["edible_parts"] = sorted(merged_parts)
            changed.append("edible_parts")

    extracted_periods = extracted.get("periods") or []
    if extracted_periods:
        existing_periods = plant_json.setdefault("periods", [])
        existing_period_types = {p.get("period_type") for p in existing_periods}
        for period in extracted_periods:
            if period["period_type"] in existing_period_types:
                continue  # a period of this type already exists from another source - don't overwrite it
            existing_periods.append(period)
            existing_period_types.add(period["period_type"])
            changed.append("periods")

    return changed


# --- Pass 3: cross-check ----------------------------------------------------

def crosscheck_pass(plant_json: dict) -> list[dict]:
    """Compares growing_information text against fields already populated
    from structured sources, flags contradictions (not omissions - a book
    not mentioning soil pH isn't an inconsistency). Findings are appended to
    growing_info_crosscheck_log.jsonl, mirroring conflicts_log.jsonl's
    append-only, human-readable pattern - this is a log for human review,
    not something that mutates the plant JSON."""
    text = _best_text(plant_json)
    if not text:
        return []

    structured_fields = {
        k: plant_json.get(k)
        for k in ("sun_level", "water_needs", "soil_type", "spread_cm", "row_spacing_cm", "height_cm", "days_to_maturity")
        if plant_json.get(k) is not None
    }
    if not structured_fields:
        return []

    slug = plant_json["slug"]
    common_name = plant_json.get("common_name", slug)
    structured_lines = "\n".join(f"- {k}: {v}" for k, v in structured_fields.items())
    prompt = (
        f"Growing-advice text for '{common_name}':\n\n{text}\n\n"
        f"Already-recorded structured data for the same plant:\n{structured_lines}\n\n"
        "List any places where the text DIRECTLY CONTRADICTS the structured "
        "data (e.g. text says 'full shade' while sun_level is full_sun). Do "
        "NOT list fields the text simply doesn't mention. If there are no "
        'contradictions, return an empty list. Respond with JSON only: '
        '{"inconsistencies": [{"field": "<field name>", "structured_value": '
        '"<value>", "text_says": "<what the text says>", "explanation": '
        '"<one sentence>"}]}.'
    )
    schema = {
        "type": "object",
        "properties": {
            "inconsistencies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "structured_value": {"type": "string"},
                        "text_says": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["field", "structured_value", "text_says", "explanation"],
                },
            }
        },
        "required": ["inconsistencies"],
    }
    try:
        parsed = _call_ollama(prompt, schema)
        findings = parsed.get("inconsistencies", [])
    except Exception as exc:  # noqa: BLE001
        print(f"[passes] crosscheck failed for {slug}: {exc!r}")
        return []

    for finding in findings:
        _append_log(CROSSCHECK_LOG, {"slug": slug, "common_name": common_name, **finding})
    return findings


# --- Pass 4: surface interesting data --------------------------------------

def surface_pass(plant_json: dict) -> list[str]:
    """Notes text that doesn't map to any existing schema field but looks
    worth a human reviewing for a future field - logged only, never
    auto-extends the schema or writes to the plant JSON (per spec)."""
    text = _best_text(plant_json)
    if not text:
        return []

    slug = plant_json["slug"]
    common_name = plant_json.get("common_name", slug)
    known_fields = (
        "common_name, botanical_name, description, sowing_method, spread_cm, "
        "row_spacing_cm, height_cm, sun_level, soil_type, composting_needs, "
        "fertilizer_needs, needs_wind_cover, needs_rain_cover, water_needs, "
        "family, genus, min/max_temperature_c, days_to_maturity, soil_ph_min/max, "
        "is_toxic, toxicity_notes, is_edible, edible_parts, succession fields, "
        "seed_info (seeds_per_gram, pretreatment, produces_viable_seeds, "
        "is_f1_hybrid), periods, companions, pest_interactions, bedding_needs"
    )
    prompt = (
        f"Growing-advice text for '{common_name}':\n\n{text}\n\n"
        f"Our plant database already has fields for: {known_fields}.\n\n"
        "List up to 5 short, concrete, practical pieces of advice in this "
        "text that do NOT fit any of those existing fields but still seem "
        "worth a human reviewing for a possible future field (e.g. "
        "culinary prep tips, specific pest remedies, historical/regional "
        "notes). Skip generic filler. If nothing stands out, return an "
        'empty list. Respond with JSON only: {"observations": ["<short '
        'note>", ...]}.'
    )
    schema = {
        "type": "object",
        "properties": {"observations": {"type": "array", "items": {"type": "string"}}},
        "required": ["observations"],
    }
    try:
        parsed = _call_ollama(prompt, schema)
        observations = parsed.get("observations", [])
    except Exception as exc:  # noqa: BLE001
        print(f"[passes] surface failed for {slug}: {exc!r}")
        return []

    for obs in observations:
        _append_log(INTERESTING_LOG, {"slug": slug, "common_name": common_name, "observation": obs})
    return observations
