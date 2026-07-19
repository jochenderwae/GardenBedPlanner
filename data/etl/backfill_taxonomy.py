"""Backfills family/genus for plants the main ETL run left with neither -
see data/CLAUDE.md's "Fields still needing a source" and the
wikipedia-taxonomy source module for why this looks up by genus, not by
plant. Deliberately a separate entrypoint, not wired into etl.run: it
operates on already-exported data/plants/*.json rather than building it
from scratch, same reasoning growing_info/run.py documents for being
separate.

Run from data/: uv run python -m etl.backfill_taxonomy
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR
from etl.sources import wikipedia_taxonomy

UNMATCHED_LOG = DATA_DIR / "taxonomy_backfill_unmatched.jsonl"


def _log_unmatched(slug: str, genus_guess: str | None, reason: str) -> None:
    entry = {"slug": slug, "genus_guess": genus_guess, "reason": reason}
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def main() -> None:
    files = sorted(PLANTS_OUT_DIR.glob("*.json"))
    missing = []
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("family") or not data.get("genus"):
            missing.append(data)
    print(f"[taxonomy-backfill] {len(missing)} plant(s) missing family and/or genus")
    if not missing:
        return

    # Group by genus (derived from botanical_name) so every cultivar sharing
    # a genus shares one Wikipedia/Wikidata lookup instead of paying for one
    # per plant - see wikipedia_taxonomy's module docstring.
    by_genus: dict[str, list[dict]] = {}
    for data in missing:
        genus = wikipedia_taxonomy.genus_from_botanical_name(data.get("botanical_name"))
        if genus:
            by_genus.setdefault(genus, []).append(data)
        else:
            print(f"[taxonomy-backfill] {data['slug']}: no usable botanical_name, logging as unmatched")
            _log_unmatched(data["slug"], None, "no genus derivable from botanical_name")

    resolved_genera, unresolved_genera = 0, 0
    for genus, plants in sorted(by_genus.items()):
        print(f"[taxonomy-backfill] resolving genus {genus!r} ({len(plants)} plant(s))...")
        try:
            result = wikipedia_taxonomy.fetch_family_for_genus(genus)
        except Exception as exc:  # noqa: BLE001 - one genus failing must not abort the batch
            print(f"[taxonomy-backfill] {genus!r} FAILED: {exc!r}")
            result = None

        if not result:
            unresolved_genera += 1
            for data in plants:
                _log_unmatched(data["slug"], genus, "wikidata lookup failed or family not found")
            continue

        resolved_genera += 1
        for data in plants:
            data["genus"] = genus
            data["family"] = result["family"]
            data.setdefault("data_sources", []).append(
                {
                    "source_url": result["source_url"],
                    "attribution": wikipedia_taxonomy.SOURCE_NAME,
                    "notes": f"family/genus backfilled from Wikipedia/Wikidata taxonomy for genus {genus!r}",
                }
            )
            path = PLANTS_OUT_DIR / f"{data['slug']}.json"
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"[taxonomy-backfill] {data['slug']}: family={result['family']!r} genus={genus!r}")

    print(
        f"[taxonomy-backfill] done: {resolved_genera} genus/genera resolved, "
        f"{unresolved_genera} unresolved (see {UNMATCHED_LOG})"
    )


if __name__ == "__main__":
    main()
