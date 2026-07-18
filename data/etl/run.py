"""Main ETL entrypoint. Run with: uv run python -m etl.run [--limit N]

Fully resumable (requirement 6): re-running after any interruption picks up
exactly where it left off, at the granularity of individual plants (see
state.py). Safe to Ctrl-C or let the laptop hibernate at any point.
"""

import argparse
import sys
import traceback
from collections import defaultdict

from etl import state
from etl.config import PLANTS_OUT_DIR
from etl.export import build_plant_json, validate, write_plant_json
from etl.matching import MasterList
from etl.merge import SourceRecord, merge_plant
from etl.sources import (
    homesteader,
    openfarm,
    permapeople,
    trefle,
    usda_plants,
    wikipedia_companions,
)


def build_master_list() -> tuple[MasterList, dict[str, list[SourceRecord]]]:
    ml = MasterList()
    per_plant: dict[str, list[SourceRecord]] = defaultdict(list)

    print("[master] fetching openfarm-crops-rescue...")
    for raw in openfarm.fetch_all():
        mapped = openfarm.map_record(raw)
        # add_distinct, not add: openfarm's own slugs are already
        # correctly distinct cultivars (Acorn Squash != Zucchini even
        # though both are Cucurbita pepo) - fuzzy-matching them against
        # each other by botanical name merges crops that shouldn't merge.
        slug = ml.add_distinct(mapped["slug"], mapped["common_name"], mapped.get("botanical_name"))
        source_url = mapped.pop("_source_url", openfarm.SOURCE_URL)
        mapped["slug"] = slug
        per_plant[slug].append(SourceRecord(openfarm.SOURCE_NAME, source_url, mapped))
    print(f"[master] openfarm contributed {len(ml.slugs)} plants")

    # Persists across all Homesteader files (not just one), so two
    # cultivars of the same species in *different* Homesteader files still
    # get treated as distinct, not merged - same reasoning as add_distinct
    # above, just spanning the whole source instead of one file.
    seen_from_homesteader: set[str] = set()
    for filename in homesteader.CROP_FILES:
        print(f"[master] fetching homesteader-labs/{filename}...")
        for raw in homesteader.fetch_crop_file(filename):
            try:
                mapped = homesteader.map_crop_record(raw)
            except KeyError as exc:
                print(f"[master] skipping malformed homesteader record in {filename}: {exc!r}")
                continue
            # Fold into an existing (openfarm) entry if this is the same
            # plant; add_distinct against anything homesteader itself
            # already contributed, matching the same reasoning as above.
            existing = ml.find(mapped["common_name"], mapped.get("botanical_name"))
            if existing and existing not in seen_from_homesteader:
                slug = existing
            else:
                slug = ml.add_distinct(mapped["slug"], mapped["common_name"], mapped.get("botanical_name"))
            seen_from_homesteader.add(slug)
            source_url = mapped.pop("_source_url", homesteader.SOURCE_URL)
            mapped["slug"] = slug
            per_plant[slug].append(SourceRecord(homesteader.SOURCE_NAME, source_url, mapped))
    print(f"[master] {len(ml.slugs)} plants after homesteader-labs")

    print("[master] fetching homesteader-labs companion-planting.json...")
    for raw in homesteader.fetch_companion_file():
        plant_id, companions = homesteader.map_companion_relationships(raw)
        if not companions:
            continue
        target_slug = plant_id if plant_id in ml.slugs else ml.find(plant_id, None)
        if target_slug:
            per_plant[target_slug].append(
                SourceRecord(homesteader.SOURCE_NAME, homesteader.SOURCE_URL, {"companions": companions})
            )

    for slug in ml.slugs:
        state.set_stage(slug, "master")

    return ml, per_plant


def enrich_plant(
    ml: MasterList,
    slug: str,
    common_name: str,
    botanical_name: str | None,
    records: list[SourceRecord],
    usda_index: dict,
    wiki_index: dict,
) -> None:
    if permapeople.is_configured():
        try:
            raw = permapeople.fetch_for_slug(slug, common_name, botanical_name)
            if raw:
                mapped = permapeople.map_record(raw)
                url = mapped.pop("_source_url", permapeople.SOURCE_URL)
                records.append(SourceRecord(permapeople.SOURCE_NAME, url, mapped))
        except Exception as exc:  # noqa: BLE001
            print(f"[{slug}] permapeople enrichment failed, skipping: {exc!r}")

    if trefle.is_configured():
        try:
            raw = trefle.fetch_for_slug(slug, common_name, botanical_name)
            if raw:
                mapped = trefle.map_record(raw)
                url = mapped.pop("_source_url", trefle.SOURCE_URL)
                records.append(SourceRecord(trefle.SOURCE_NAME, url, mapped))
        except Exception as exc:  # noqa: BLE001
            print(f"[{slug}] trefle enrichment failed, skipping: {exc!r}")

    usda_entry = usda_index.get(common_name.lower())
    if usda_entry:
        records.append(
            SourceRecord(usda_plants.SOURCE_NAME, usda_plants.SOURCE_URL, usda_entry)
        )

    wiki_entry = wiki_index.get(common_name.lower())
    if wiki_entry:
        resolved_companions = []
        for c in wiki_entry.get("companions", []):
            target = ml.find(c.get("companion_slug_hint"), None)
            if target and target != slug:
                resolved_companions.append(
                    {"companion_slug": target, "relationship": c["relationship"], "notes": c.get("notes")}
                )
        data = {}
        if resolved_companions:
            data["companions"] = resolved_companions
        if wiki_entry.get("pest_interactions"):
            data["pest_interactions"] = wiki_entry["pest_interactions"]
        if data:
            records.append(
                SourceRecord(wikipedia_companions.SOURCE_NAME, wikipedia_companions.PAGE_URL, data)
            )

    state.set_stage(slug, "enriched")


def export_plant(slug: str, records: list[SourceRecord]) -> None:
    wr = merge_plant(slug, records)
    plant_json = build_plant_json(wr)
    validate(plant_json)
    write_plant_json(plant_json)
    state.set_stage(slug, "exported")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N plants (testing)")
    args = parser.parse_args()

    state.init_db()

    ml, per_plant = build_master_list()
    slugs = sorted(ml.slugs)
    if args.limit:
        slugs = slugs[: args.limit]

    print("[usda] loading taxonomy index (one-time bulk fetch)...")
    usda_index = usda_plants.build_taxonomy_index()
    print("[wikipedia] loading companion-plants page (one-time bulk fetch)...")
    wiki_index = wikipedia_companions.fetch_and_parse()

    total = len(slugs)
    for i, slug in enumerate(slugs, 1):
        entry = ml.slugs[slug]
        common_name, botanical_name = entry["common_name"], entry["botanical_name"]

        if state.stage_reached(slug, "exported"):
            continue

        print(f"[{i}/{total}] {slug} ({common_name})")
        try:
            if not state.stage_reached(slug, "enriched"):
                enrich_plant(ml, slug, common_name, botanical_name, per_plant[slug], usda_index, wiki_index)
            export_plant(slug, per_plant[slug])
        except Exception:
            print(f"[{slug}] FAILED, will retry on next run:", file=sys.stderr)
            traceback.print_exc()
            continue

    summary = state.progress_summary()
    print(f"Done. Progress: {summary}. Output in {PLANTS_OUT_DIR}")


if __name__ == "__main__":
    main()
