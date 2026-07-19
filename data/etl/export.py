"""Stage 4: build the final data/plants/<slug>.json from a merged working
record (+ Ollama resolution for genuine conflicts), validate against
plant.schema.json, write to disk."""

import json

import jsonschema

from etl.config import PLANT_SCHEMA_PATH, PLANTS_OUT_DIR
from etl.merge import WorkingRecord
from etl.normalize import title_case_plant_name
from etl.ollama_resolve import (
    infer_botanical_name,
    resolve_companion_conflict,
    resolve_scalar_field,
)

_SOURCE_URLS = {
    "openfarm-crops-rescue": "https://github.com/thefullnacho/openfarm-crops-rescue",
    "homesteader-labs": "https://github.com/thefullnacho/homesteader-labs-next/tree/master/content/crops",
    "permapeople": "https://permapeople.org",
    "usda-plants": "https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt",
    "wikipedia-companion-plants": "https://en.wikipedia.org/wiki/List_of_companion_plants",
    "trefle": "https://trefle.io",
}

# infer_botanical_name is deliberately conservative and declines (returns
# null) rather than guess - correct behavior in general, but it means a
# handful of real plants with obscure/regional common names never export.
# For those, a human (not Ollama) looked it up and verified it; recorded
# here rather than looser-matched against a source, with its own
# data_sources attribution so it's still clearly distinguished from an
# actual external database record.
_MANUAL_BOTANICAL_NAME_OVERRIDES = {
    # Māori heirloom summer squash (NZ), also called kumi kumi - not
    # confidently known to the inference model, confirmed via Wikipedia
    # and multiple seed-catalog sources (Baker Creek, The Seed Collection).
    "kamokamo": "Cucurbita pepo",
}

with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
    _SCHEMA = json.load(f)


def build_plant_json(wr: WorkingRecord) -> dict:
    out: dict = {"slug": wr.slug}

    for field_name, candidates in wr.scalars.items():
        if not candidates.values:
            continue
        if candidates.is_unambiguous:
            out[field_name] = candidates.single_value
        else:
            common_name = wr.scalars["common_name"].single_value or wr.slug
            botanical_name = wr.scalars["botanical_name"].single_value
            resolved, _reasoning = resolve_scalar_field(
                wr.slug, common_name, botanical_name, field_name, candidates.values
            )
            out[field_name] = resolved

    # Sources disagree wildly on common_name casing ('bitter orange',
    # 'Adjuma pepper', 'Matariki Taewa Potato' all seen for real) - normalize
    # every export so this doesn't have to be a recurring manual cleanup.
    if out.get("common_name"):
        out["common_name"] = title_case_plant_name(out["common_name"])

    botanical_name_inferred = False
    botanical_name_manual = False
    if not out.get("botanical_name") and wr.slug in _MANUAL_BOTANICAL_NAME_OVERRIDES:
        out["botanical_name"] = _MANUAL_BOTANICAL_NAME_OVERRIDES[wr.slug]
        botanical_name_manual = True
    if not out.get("botanical_name"):
        # Required field (matches the non-nullable Postgres column), but
        # some cultivars have no source with a botanical name at all - see
        # infer_botanical_name's docstring.
        common_name = out.get("common_name") or wr.slug
        inferred, _reasoning = infer_botanical_name(
            wr.slug, common_name, out.get("description")
        )
        if inferred:
            out["botanical_name"] = inferred
            botanical_name_inferred = True

    if wr.edible_parts.values:
        merged: set[str] = set()
        for value_tuple, _source in wr.edible_parts.values:
            merged.update(value_tuple)
        out["edible_parts"] = sorted(merged)

    companions = []
    common_name = wr.scalars["common_name"].single_value or wr.slug
    for companion_slug, entries in wr.companions.items():
        relationships = {e.get("relationship") for e in entries}
        if len(relationships) > 1:
            relationship, _reasoning = resolve_companion_conflict(
                wr.slug, common_name, companion_slug, entries
            )
        else:
            relationship = entries[0].get("relationship")
        mechanism = next((e.get("mechanism") for e in entries if e.get("mechanism")), None)
        notes_parts = list(dict.fromkeys(e["notes"] for e in entries if e.get("notes")))
        companions.append(
            {
                "companion_slug": companion_slug,
                "relationship": relationship,
                **({"mechanism": mechanism} if mechanism else {}),
                **({"notes": " | ".join(notes_parts)} if notes_parts else {}),
            }
        )
    if companions:
        out["companions"] = companions

    pest_interactions = []
    for pest_name, entries in wr.pest_interactions.items():
        # Simple fallback for list-field conflicts here (unlike scalars/
        # companions): highest-priority source wins on interaction_type,
        # notes still merged. See ollama_resolve.py's docstring for why
        # full LLM resolution was scoped to scalars + companions only.
        interaction_type = entries[0].get("interaction_type")
        notes_parts = list(dict.fromkeys(e["notes"] for e in entries if e.get("notes")))
        pest_interactions.append(
            {
                "interaction_type": interaction_type,
                "pest_or_insect": pest_name,
                **({"notes": " | ".join(notes_parts)} if notes_parts else {}),
            }
        )
    if pest_interactions:
        out["pest_interactions"] = pest_interactions

    periods = []
    for period_type, entries in wr.periods.items():
        starts = [e["start_month"] for e in entries if e.get("start_month")]
        ends = [e["end_month"] for e in entries if e.get("end_month")]
        if starts and ends:
            periods.append(
                {"period_type": period_type, "start_month": min(starts), "end_month": max(ends)}
            )
    if periods:
        out["periods"] = periods

    bedding_needs = []
    for need_type, entries in wr.bedding_needs.items():
        notes_parts = list(dict.fromkeys(e["notes"] for e in entries if e.get("notes")))
        bedding_needs.append(
            {
                "need_type": need_type,
                **({"notes": " | ".join(notes_parts)} if notes_parts else {}),
            }
        )
    if bedding_needs:
        out["bedding_needs"] = bedding_needs

    out["data_sources"] = [
        {"source_url": _SOURCE_URLS.get(src, src), "attribution": src}
        for src in sorted(wr.sources_used)
    ]
    if botanical_name_inferred:
        out["data_sources"].append(
            {
                "attribution": "ollama-inference",
                "notes": "botanical_name inferred from common_name by Ollama - no source had one; not sourced from an external database, verify before trusting",
            }
        )
    if botanical_name_manual:
        out["data_sources"].append(
            {
                "attribution": "manual-verification",
                "notes": "botanical_name inferred value declined by Ollama (not confident) - manually verified against public sources instead; see _MANUAL_BOTANICAL_NAME_OVERRIDES in export.py",
            }
        )

    return out


def validate(plant_json: dict) -> None:
    jsonschema.validate(plant_json, _SCHEMA)


def write_plant_json(plant_json: dict) -> None:
    path = PLANTS_OUT_DIR / f"{plant_json['slug']}.json"
    path.write_text(json.dumps(plant_json, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
