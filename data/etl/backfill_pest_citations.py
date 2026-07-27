"""One-off backfill for GitHub issue #151: leftover Wikipedia reference-
citation markers (e.g. "[6]", "[ 39 ]") leaking into already-exported
data/plants/*.json pest_interactions[].pest_or_insect values - e.g.
chives.json showing "[ 6 ] mites" and "[ 6 ] nematodes [ 6 ]" instead of
"mites"/"nematodes".

Root cause (fixed at the source in etl/sources/wikipedia_companions.py's
_split_names, see that module's comment): Wikipedia's "List of companion
plants" table cells carry <sup> reference-citation markers inline with
the pest/plant names, and BeautifulSoup's get_text() flattened those into
the cell's plain text. Most citations sit next to a name with a comma
already separating them from a neighbour and just needed stripping; one
real case (basil.json) had a citation glued onto a sentence-ending period
with no comma ("Slugs and snails.[39] butterflies"), which the original
parser left as one mangled string spanning two actual pest names.

That source fix only affects a *future* fresh `etl.run` (re-scraping
Wikipedia from scratch, not something to do lightly - see data/CLAUDE.md's
per-source rate limiting/caching notes). This script instead re-applies
the exact same cleanup logic to the pest_or_insect values already sitting
in data/plants/*.json, so existing data is fixed without a full re-run:
runs each existing pest_or_insect string back through
wikipedia_companions._split_names (the same function the live scraper now
uses), which strips citation markers, splits any citation-glued multi-name
entries into separate entries, and drops entries left with no name at all
once the citation is removed.

Run from data/: uv run python -m etl.backfill_pest_citations
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR
from etl.sources.wikipedia_companions import _split_names

DROPPED_LOG = DATA_DIR / "pest_citation_backfill_dropped.jsonl"


def clean_pest_interactions(entries: list[dict], slug: str) -> tuple[list[dict], int, list[dict]]:
    """Returns (new pest_interactions list, number of entries changed,
    entries dropped entirely because nothing but a citation marker was
    left)."""
    cleaned: list[dict] = []
    changed = 0
    dropped: list[dict] = []
    for entry in entries:
        original = entry.get("pest_or_insect", "")
        names = _split_names(original)
        if not names:
            dropped.append({"slug": slug, "interaction_type": entry.get("interaction_type"), "original": original})
            changed += 1
            continue
        if len(names) == 1 and names[0] == original:
            cleaned.append(entry)
            continue
        changed += 1
        for name in names:
            new_entry = dict(entry)
            new_entry["pest_or_insect"] = name
            cleaned.append(new_entry)
    return cleaned, changed, dropped


def main() -> None:
    plants_changed = 0
    entries_changed = 0
    all_dropped: list[dict] = []

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        interactions = data.get("pest_interactions")
        if not interactions:
            continue
        cleaned, changed, dropped = clean_pest_interactions(interactions, data["slug"])
        if not changed:
            continue
        print(f"[backfill_pest_citations] {data['slug']}: {changed} pest_interactions entr{'y' if changed == 1 else 'ies'} cleaned")
        data["pest_interactions"] = cleaned
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        plants_changed += 1
        entries_changed += changed
        all_dropped.extend(dropped)

    if all_dropped:
        with open(DROPPED_LOG, "a", encoding="utf-8") as f:
            for entry in all_dropped:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"[backfill_pest_citations] {len(all_dropped)} entr{'y' if len(all_dropped) == 1 else 'ies'} had no name left after citation removal - dropped, logged to {DROPPED_LOG}")

    print(f"[backfill_pest_citations] done: {entries_changed} pest_interactions entries cleaned across {plants_changed} plant(s)")


if __name__ == "__main__":
    main()
