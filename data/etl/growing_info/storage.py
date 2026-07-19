"""Storage side of growing_information ingestion - appends `raw` entries to
a plant's data/plants/<slug>.json, re-validating against plant.schema.json
before every write (same requirement as the main pipeline's export.py).

Deliberately source-agnostic: nothing here mentions Gutenberg or books.
fetch.py/split.py/match.py are the Gutenberg-specific pieces; this module
just knows how to append a `growing_information` entry (whatever text/
source_url/attribution it carries) onto a plant record. A future long-form
source (a different book collection, an extension-service PDF, whatever)
plugs into this same function.
"""

import json

from etl.config import PLANTS_OUT_DIR
from etl.export import validate, write_plant_json


def load_plant_json(slug: str) -> dict:
    path = PLANTS_OUT_DIR / f"{slug}.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def plant_exists(slug: str) -> bool:
    return (PLANTS_OUT_DIR / f"{slug}.json").exists()


def add_growing_info_entry(
    plant_json: dict,
    *,
    text: str,
    source_url: str | None,
    attribution: str | None,
    copyright_status: str | None,
    record_type: str = "raw",
    generic_for_species: bool = False,
) -> bool:
    """Appends one growing_information entry. Returns False without
    modifying plant_json if an entry with the same (source_url, text)
    already exists - makes re-running ingestion after an interruption safe
    even for the one section that was mid-write when it crashed, without
    relying solely on state.py's checkpoint (belt and suspenders, cheap to
    check)."""
    entries = plant_json.setdefault("growing_information", [])
    for existing in entries:
        if existing.get("source_url") == source_url and existing.get("text") == text:
            return False

    entry = {"text": text, "record_type": record_type}
    if source_url is not None:
        entry["source_url"] = source_url
    if attribution is not None:
        entry["attribution"] = attribution
    if copyright_status is not None:
        entry["copyright_status"] = copyright_status
    if generic_for_species:
        entry["generic_for_species"] = True
    entries.append(entry)
    return True


def add_data_source_if_missing(plant_json: dict, *, source_url: str | None, attribution: str, notes: str | None = None) -> None:
    sources = plant_json.setdefault("data_sources", [])
    for existing in sources:
        if existing.get("attribution") == attribution and existing.get("source_url") == source_url:
            return
    entry: dict = {"attribution": attribution}
    if source_url is not None:
        entry["source_url"] = source_url
    if notes is not None:
        entry["notes"] = notes
    sources.append(entry)


def save_plant_json(plant_json: dict) -> None:
    validate(plant_json)
    write_plant_json(plant_json)
