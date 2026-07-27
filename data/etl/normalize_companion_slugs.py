"""One-off backfill for GitHub issue #164: `companions[].companion_slug`
values that are near-misses of a real `data/plants/<slug>.json` file
rather than the real slug itself (e.g. `basil.json` listing
`pepper-bell` when the real file is `bell-pepper.json`) - previously
silently dropped a real companion relationship at import time
(`import_plants.py` already skips dangling references gracefully rather
than failing, per its own git history, which is exactly why this went
unnoticed).

**Full-dataset scan found 72 dangling companion_slug references, not just
the 2 named in the issue.** Investigated all 72 individually (fuzzy-
matched against the real slug set, then manually reviewed each candidate
- see this module's own ALIAS_MAP for exactly which ones turned out to be
confident near-misses) rather than auto-accepting every fuzzy match:
~45 of the 72 are references to a plant that genuinely has no record in
this database at all (e.g. `millet`, `nasturtium`, cultivar-specific
references like `carrot-scarlet-nantes` or `green-danjou-pear`) - not
typos, just missing plants. Aliasing those to a superficially-similar
but actually-different real slug would be a real data-quality bug, not a
fix, so this script deliberately does NOT touch them - they're logged to
DANGLING_LOG instead, same "log it, don't guess" discipline as every
other backfill in this pipeline.

Two confirmed alias-application collisions (a plant listing BOTH the
near-miss AND the real slug already, e.g. eggplant.json has both
`pepper-bell` and `bell-pepper` with the same `good` relationship) are
deduplicated rather than left as two entries for the same real companion.

Run from data/: uv run python -m etl.normalize_companion_slugs
"""

import json

from etl.config import DATA_DIR, PLANTS_OUT_DIR

DANGLING_LOG = DATA_DIR / "companion_slug_dangling.jsonl"

# Confirmed near-misses only (see module docstring) - every value here is
# a real data/plants/<slug>.json file, verified before adding.
ALIAS_MAP: dict[str, str] = {
    "pepper-bell": "bell-pepper",
    "beets": "beet",
    "dill-1": "dill",
    "kale-1": "kale",
    "horseradish-2": "horseradish",
    "lemon-balm-1": "lemon-balm",
    "turnip-2": "turnip",
    "groundnut-1": "groundnut",
    "french-marigold": "african-marigold",
    "marigold": "african-marigold",
    "cucumber-heirloom-straight-eight": "cucumber-straight-eight",
}


def normalize_companions(companions: list[dict], real_slugs: set[str]) -> tuple[list[dict], int, list[dict]]:
    """Returns (new companions list, number of entries renamed, still-
    dangling entries to log). Two passes rather than one, so a collision
    is caught regardless of which order the real slug and its near-miss
    duplicate happen to appear in (e.g. eggplant.json has the real
    'bell-pepper' entry before its 'pepper-bell' duplicate, but nothing
    guarantees every plant's list is ordered that way)."""
    effective_slugs = [ALIAS_MAP.get(e.get("companion_slug"), e.get("companion_slug")) for e in companions]

    renamed = 0
    seen_slugs: set[str] = set()
    result: list[dict] = []
    dangling: list[dict] = []

    for entry, effective_slug in zip(companions, effective_slugs, strict=True):
        original_slug = entry.get("companion_slug")
        if original_slug in ALIAS_MAP:
            renamed += 1
        if effective_slug in seen_slugs:
            continue  # collision - the real slug is already present (from this or an earlier entry), drop the duplicate
        seen_slugs.add(effective_slug)
        if original_slug in ALIAS_MAP:
            entry = {**entry, "companion_slug": effective_slug}
        elif original_slug and original_slug not in real_slugs:
            dangling.append(entry)
        result.append(entry)

    return result, renamed, dangling


def main() -> None:
    real_slugs = {p.stem for p in PLANTS_OUT_DIR.glob("*.json")}
    plants_changed = 0
    entries_renamed = 0
    all_dangling: list[dict] = []

    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        companions = data.get("companions")
        if not companions:
            continue

        new_companions, renamed, dangling = normalize_companions(companions, real_slugs)
        for d in dangling:
            all_dangling.append({"slug": data["slug"], "companion_slug": d.get("companion_slug")})

        if not renamed:
            continue

        data["companions"] = new_companions
        data.setdefault("data_sources", []).append(
            {
                "attribution": "manual-companion-slug-normalization",
                "notes": (
                    f"{renamed} companion_slug reference(s) corrected to the real plant slug "
                    "(GitHub issue #164) - see etl/normalize_companion_slugs.py's ALIAS_MAP."
                ),
            }
        )
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        plants_changed += 1
        entries_renamed += renamed
        print(f"[normalize_companion_slugs] {data['slug']}: {renamed} companion_slug reference(s) fixed")

    if all_dangling:
        with open(DANGLING_LOG, "a", encoding="utf-8") as f:
            for entry in all_dangling:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"[normalize_companion_slugs] {len(all_dangling)} still-dangling reference(s) (no confident alias) logged to {DANGLING_LOG}")

    print(f"[normalize_companion_slugs] done: {entries_renamed} reference(s) fixed across {plants_changed} plant(s)")


if __name__ == "__main__":
    main()
