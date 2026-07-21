"""Growing-information ingestion + post-processing entrypoint. Run with:
    uv run python -m etl.growing_info.run [--books 43531,7123] [--limit N]

Deliberately a SEPARATE entrypoint from `etl.run` (the main plant-database
ETL), not merged into it - this pipeline reads/updates already-exported
data/plants/*.json rather than building it from scratch, and per
data/CLAUDE.md is intentionally decoupled from the main pipeline's run.

Two phases, each independently skippable (--skip-ingestion / --skip-passes)
and independently resumable (etl/growing_info/state.py):

1. Ingestion: fetch each book -> split into candidate sections -> classify
   each with Ollama -> match plant-content sections to known plants ->
   append `raw` growing_information entries to the matched plant JSON(s).
2. Passes: for every plant that now has growing_information, run the four
   Ollama passes (consolidate, extract, crosscheck, surface) from passes.py.
"""

import argparse
import json
from datetime import datetime, timezone

from etl.config import DATA_DIR
from etl.growing_info import fetch, match, passes, split, state, storage
from etl.matching import slugify

UNMATCHED_LOG = DATA_DIR / "growing_info_unmatched.jsonl"

_EMBEDDING_CACHE_PATH = DATA_DIR / ".cache" / "gutenberg" / "plant_embeddings.json"


def _section_id(section: split.Section) -> str:
    label = section.anchor_id or slugify(section.heading_text)[:40]
    return f"{section.book_id}:{section.index}:{label}"


def _load_or_build_embedding_index(index: list[match.PlantEntry]) -> dict[str, list[float]]:
    """Cached to disk (like every other bulk-fetched source in this
    pipeline) so a resumed run doesn't redo 359 embedding calls - all-minilm
    is fast, but there's no reason to pay for it twice."""
    if _EMBEDDING_CACHE_PATH.exists():
        cached = json.loads(_EMBEDDING_CACHE_PATH.read_text(encoding="utf-8"))
        if set(cached.keys()) >= {e.slug for e in index}:
            return cached
    print(f"[growing_info] building embedding index for {len(index)} known plants (all-minilm)...")
    embedding_index = match.build_embedding_index(index)
    _EMBEDDING_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _EMBEDDING_CACHE_PATH.write_text(json.dumps(embedding_index), encoding="utf-8")
    return embedding_index


def _log_unmatched(section: split.Section, plant_name_guess: str | None) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "book_id": section.book_id,
        "heading": section.heading_text,
        "plant_name_guess": plant_name_guess,
        "text_preview": section.text[:300],
    }
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def run_ingestion(book_ids: list[str] | None, section_limit: int | None) -> None:
    books_to_fetch = fetch.BOOKS if not book_ids else [b for b in fetch.BOOKS if b["id"] in book_ids]
    if not books_to_fetch:
        print(f"[growing_info] no books matched --books filter {book_ids!r}")
        return

    print("[growing_info] loading known-plant index...")
    index = match.load_plant_index()
    embedding_index = _load_or_build_embedding_index(index)

    total_matched = 0
    total_unmatched = 0
    total_skipped_content = 0

    for b in books_to_fetch:
        print(f"[growing_info] fetching book {b['id']}...")
        book = fetch.fetch_book(b["id"], b["url"])
        sections = split.extract_candidate_sections(book)
        print(f"[growing_info] book {b['id']} ({book.title!r}): {len(sections)} candidate sections, copyright_status={book.copyright_status!r}")
        if section_limit:
            sections = sections[:section_limit]

        for i, section in enumerate(sections, 1):
            section_id = _section_id(section)
            if state.is_section_done(section_id):
                continue

            is_plant, guess = split.classify_section(section)
            if not is_plant:
                total_skipped_content += 1
                state.mark_section_done(section_id, book.book_id, [])
                continue

            matched_slug = match.match_section(section, guess, index, embedding_index)
            if not matched_slug:
                _log_unmatched(section, guess)
                total_unmatched += 1
                state.mark_section_done(section_id, book.book_id, [])
                continue

            cultivar_slugs = match.find_cultivar_matches(matched_slug, index)
            target_slugs = [matched_slug, *cultivar_slugs]

            source_url = book.url + (f"#{section.anchor_id}" if section.anchor_id else "")
            for slug in target_slugs:
                if not storage.plant_exists(slug):
                    continue  # defensive - shouldn't happen, index is built from these same files
                plant_json = storage.load_plant_json(slug)
                added = storage.add_growing_info_entry(
                    plant_json,
                    text=section.text,
                    source_url=source_url,
                    attribution=book.title,
                    copyright_status=book.copyright_status,
                    record_type="raw",
                    generic_for_species=(slug != matched_slug),
                )
                if added:
                    storage.add_data_source_if_missing(
                        plant_json, source_url=book.url, attribution=fetch.SOURCE_NAME,
                        notes=f"growing_information text sourced from '{book.title}'",
                    )
                    storage.save_plant_json(plant_json)

            state.mark_section_done(section_id, book.book_id, target_slugs)
            total_matched += 1
            print(f"[growing_info] [{i}/{len(sections)}] {book.book_id}#{section.anchor_id or i} '{section.heading_text}' -> {target_slugs}")

    print(
        f"[growing_info] ingestion done: {total_matched} matched, {total_unmatched} unmatched "
        f"(see {UNMATCHED_LOG}), {total_skipped_content} not plant content"
    )


def run_passes(plant_limit: int | None) -> None:
    index = match.load_plant_index()
    slugs_with_growing_info = []
    for entry in index:
        plant_json = storage.load_plant_json(entry.slug)
        if plant_json.get("growing_information"):
            slugs_with_growing_info.append(entry.slug)
    if plant_limit:
        slugs_with_growing_info = slugs_with_growing_info[:plant_limit]

    print(f"[growing_info] running 4 passes over {len(slugs_with_growing_info)} plants with growing_information")

    for i, slug in enumerate(slugs_with_growing_info, 1):
        plant_json = storage.load_plant_json(slug)
        changed = False

        if not state.is_pass_done(slug, "consolidate"):
            try:
                entry = passes.consolidate_pass(plant_json)
            except passes.ConsolidationFailed as exc:
                # Don't mark done - a genuine call failure (timeout, bad
                # JSON, etc.), not "nothing to consolidate". Leaving the
                # checkpoint unset means the next run_passes invocation
                # retries this plant instead of silently losing it (see
                # passes.CONSOLIDATE_FAILURE_LOG's docstring for the
                # celery incident that motivated this).
                print(f"[growing_info] consolidate failed for {slug}, will retry next run: {exc}")
            else:
                if entry:
                    added = storage.add_growing_info_entry(
                        plant_json, text=entry["text"], source_url=None,
                        attribution=entry["attribution"], copyright_status=entry["copyright_status"],
                        record_type="consolidated",
                    )
                    changed = changed or added
                state.mark_pass_done(slug, "consolidate")

        if changed:
            storage.save_plant_json(plant_json)
            changed = False

        if not state.is_pass_done(slug, "extract"):
            changed_fields = passes.extract_pass(plant_json)
            if changed_fields:
                storage.save_plant_json(plant_json)
            state.mark_pass_done(slug, "extract")

        if not state.is_pass_done(slug, "crosscheck"):
            passes.crosscheck_pass(plant_json)
            state.mark_pass_done(slug, "crosscheck")

        if not state.is_pass_done(slug, "surface"):
            passes.surface_pass(plant_json)
            state.mark_pass_done(slug, "surface")

        print(f"[growing_info] [{i}/{len(slugs_with_growing_info)}] passes done for {slug}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--books", type=str, default=None, help="Comma-separated Gutenberg book ids to process (default: all 7)")
    parser.add_argument("--limit", type=int, default=None, help="Limit candidate sections processed per book (testing)")
    parser.add_argument("--plant-limit", type=int, default=None, help="Limit plants processed in the 4 passes (testing)")
    parser.add_argument("--skip-ingestion", action="store_true")
    parser.add_argument("--skip-passes", action="store_true")
    args = parser.parse_args()

    state.init_db()

    book_ids = args.books.split(",") if args.books else None

    if not args.skip_ingestion:
        run_ingestion(book_ids, args.limit)
    if not args.skip_passes:
        run_passes(args.plant_limit)


if __name__ == "__main__":
    main()
