"""One-off backfill for GitHub issue #135: data_sources[] entries for
Project Gutenberg books carry the generic attribution "project-gutenberg"
(fetch.SOURCE_NAME - see growing_info/fetch.py), even though the matching
growing_information[] entry for the same book (same source_url, modulo the
#anchor a growing_information entry adds for its specific section) already
carries the real book title as its own attribution (set from book.title in
growing_info/run.py).

For every data_sources[] entry whose attribution is the generic
"project-gutenberg" label, find the growing_information[] entry with the
same base source_url (fragment stripped) and copy its attribution (the real
book title) over. Entries with no matching growing_information[] entry are
left as-is and logged - shouldn't happen in practice (see run.py: the two
are always written together), but log rather than guess if it ever does.

Run from data/: uv run python -m etl.backfill_book_attribution
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR

GENERIC_ATTRIBUTION = "project-gutenberg"
UNMATCHED_LOG = DATA_DIR / "book_attribution_backfill_unmatched.jsonl"


def _base_url(url: str) -> str:
    return url.split("#", 1)[0]


def _book_titles_by_url(growing_information: list[dict]) -> dict[str, str]:
    titles: dict[str, str] = {}
    for entry in growing_information:
        url = entry.get("source_url")
        attribution = entry.get("attribution")
        if not url or not attribution or attribution == GENERIC_ATTRIBUTION:
            continue
        titles.setdefault(_base_url(url), attribution)
    return titles


def backfill_plant(data: dict) -> tuple[int, list[dict]]:
    """Returns (number of data_sources entries fixed, unmatched entries logged)."""
    titles = _book_titles_by_url(data.get("growing_information", []))
    changed = 0
    unmatched = []
    for ds in data.get("data_sources", []):
        if ds.get("attribution") != GENERIC_ATTRIBUTION:
            continue
        url = ds.get("source_url")
        title = titles.get(_base_url(url)) if url else None
        if title:
            ds["attribution"] = title
            changed += 1
        else:
            unmatched.append({"slug": data.get("slug"), "source_url": url})
    return changed, unmatched


def main() -> None:
    plants_changed = 0
    entries_changed = 0
    all_unmatched: list[dict] = []

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        changed, unmatched = backfill_plant(data)
        all_unmatched.extend(unmatched)
        if changed:
            print(f"[backfill_book_attribution] {data['slug']}: {changed} data_sources entr{'y' if changed == 1 else 'ies'} fixed")
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            plants_changed += 1
            entries_changed += changed

    if all_unmatched:
        with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
            for entry in all_unmatched:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"[backfill_book_attribution] {len(all_unmatched)} data_sources entr{'y' if len(all_unmatched) == 1 else 'ies'} had no matching growing_information entry - logged to {UNMATCHED_LOG}")

    print(f"[backfill_book_attribution] done: {entries_changed} data_sources entries fixed across {plants_changed} plant(s)")


if __name__ == "__main__":
    main()
