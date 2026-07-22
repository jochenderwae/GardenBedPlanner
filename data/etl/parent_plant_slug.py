"""Cultivar-to-species linkage (GitHub issue #111): computes `parent_plant_slug`
for plants that are a named cultivar/variety of another plant already in
data/plants/*.json, and backfills it.

Design: NOT the same botanical-name matching that data/etl/matching.py's
module docstring warns is unsafe for merging (openfarm's Acorn
Squash/Zucchini/Pumpkin/Delicata Squash/Pattypan Squash/Spaghetti Squash are
all Cucurbita pepo but are NOT cultivars of one another). That lesson
applies here too: two plants sharing a normalized (genus, species) is
necessary but nowhere near sufficient - `brassica oleracea` alone covers
broccoli/cabbage/cauliflower/kale/kohlrabi/collard-greens/romanesco, which
are agriculturally distinct crops, not cultivars of a shared "cabbage"
parent. Purely botanical grouping would wrongly parent every one of them
under whichever happened to sort first.

The extra, load-bearing signal used here is the plant's own `common_name`:
a genuine cultivar's common name almost always contains its species'
common name as a whole-word phrase ("Brandywine Tomato" contains "Tomato",
"Fuji Apple" contains "Apple", "Cheongyang Chili Pepper" contains "Chili
Pepper"), while agriculturally-distinct-but-botanically-identical crops
don't share a name at all ("Broccoli" doesn't contain "Cabbage").
Concretely: within a (genus, species) group, plant A is a candidate parent
of plant B if A's common-name word set is a *strict, non-empty subset* of
B's - i.e. every word in A's name appears in B's name, with B having at
least one more. Among multiple candidate parents for one plant (e.g. a
"cherry tomato" cultivar could subset-match both "tomato" and "cherry
tomato"), the most specific one wins (largest word-set) - this naturally
builds a two-level hierarchy where a more specific intermediate record
exists (bonnie-little-bing-compact-cherry-tomato -> cherry-tomato ->
[cherry-tomato's own parent_plant_slug, if any, is left for a human/a
future pass - this module only assigns one level per run, matching the
non-overwriting behavior below]). A genuine tie (two equally-specific,
different candidates) is logged rather than guessed.

Deliberately conservative: plurals ("carrots" vs "carrot", "cherry-tomato"
vs "cherry-tomatoes", "peas" vs "pea") don't share an exact word and so are
NOT linked - those look like separate near-duplicate-stub data-quality
issues (already flagged in data/suggestions.md for some of them), not
cultivar relationships, and it's safer to leave them unlinked than guess.

Never overwrites an existing parent_plant_slug (same "only fill empty
fields" convention as growing_info/passes.py's extract_pass) - this makes
the backfill safe to re-run indefinitely, including as the final step of a
full etl.run (see run.py), which is how "wired in for new cultivars going
forward" is satisfied: every future full run recomputes this over the
complete, current data/plants/*.json set as its last step, so a newly
added cultivar picks up its parent (and any newly added plant that BECOMES
a valid parent for an existing, previously-unmatched cultivar also gets
picked up) without a separate manual command.

Run standalone from data/: uv run python -m etl.parent_plant_slug
"""

import json
import re
from collections import defaultdict

from etl.config import DATA_DIR, PLANTS_OUT_DIR
from etl.matching import normalize_botanical

_WORD_RE = re.compile(r"[a-z0-9]+")

AMBIGUOUS_LOG = DATA_DIR / "parent_plant_slug_ambiguous.jsonl"


def _name_words(common_name: str | None) -> frozenset[str]:
    """Extracts lowercase alnum word tokens, stripping punctuation from
    within a token rather than dropping the whole token - e.g. 'Eggplant,
    Black Beauty' -> {'eggplant', 'black', 'beauty'}, not just {'black',
    'beauty'} (a real bug hit during development: a comma-attached word
    was silently discarded entirely by an earlier `w.isalnum()`-filtering
    version, which spuriously turned two duplicate-stub records -
    black-beauty-eggplant.json / eggplant-black-beauty.json, same plant,
    different word order/punctuation - into a false parent/child pair
    instead of both correctly subset-matching only 'eggplant')."""
    if not common_name:
        return frozenset()
    return frozenset(_WORD_RE.findall(common_name.lower()))


def _species_groups(plants: dict[str, dict]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for slug, data in plants.items():
        norm = normalize_botanical(data.get("botanical_name"))
        if norm:
            groups[norm].append(slug)
    return {norm: slugs for norm, slugs in groups.items() if len(slugs) > 1}


def compute_parent_assignments(
    plants: dict[str, dict],
) -> tuple[dict[str, str], list[dict]]:
    """Returns (slug -> parent_slug for confidently-resolved plants,
    ambiguous-tie entries for slugs that had 2+ equally-good candidates)."""
    assignments: dict[str, str] = {}
    ambiguous: list[dict] = []

    for norm_botanical, slugs in _species_groups(plants).items():
        words_by_slug = {s: _name_words(plants[s].get("common_name")) for s in slugs}
        for slug, words in words_by_slug.items():
            if not words:
                continue
            candidates = [
                (other, len(other_words))
                for other, other_words in words_by_slug.items()
                if other != slug and other_words and other_words < words
            ]
            if not candidates:
                continue
            best_len = max(c[1] for c in candidates)
            best = sorted(c[0] for c in candidates if c[1] == best_len)
            if len(best) == 1:
                assignments[slug] = best[0]
            else:
                ambiguous.append(
                    {
                        "slug": slug,
                        "common_name": plants[slug].get("common_name"),
                        "botanical_group": norm_botanical,
                        "candidate_parents": best,
                        "reason": "tied on word-set specificity - not guessed",
                    }
                )
    return assignments, ambiguous


def backfill_all() -> dict:
    """Loads every data/plants/*.json, computes cultivar->species
    assignments, writes parent_plant_slug for any plant that doesn't
    already have one set, logs ties. Safe to call repeatedly (only ever
    fills an empty field; re-logs ties every call, same append-only
    audit-trail convention as taxonomy_backfill_unmatched.jsonl)."""
    plants: dict[str, dict] = {}
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        plants[data["slug"]] = data

    assignments, ambiguous = compute_parent_assignments(plants)

    updated = 0
    for slug, parent_slug in sorted(assignments.items()):
        data = plants[slug]
        if data.get("parent_plant_slug"):
            continue  # never overwrite - matches extract_pass's "fill empty only" convention
        data["parent_plant_slug"] = parent_slug
        path = PLANTS_OUT_DIR / f"{slug}.json"
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[parent_plant_slug] {slug} -> parent_plant_slug={parent_slug!r}")
        updated += 1

    if ambiguous:
        with open(AMBIGUOUS_LOG, "a", encoding="utf-8") as f:
            for entry in ambiguous:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {"updated": updated, "ambiguous": len(ambiguous), "log": str(AMBIGUOUS_LOG) if ambiguous else None}


def main() -> None:
    stats = backfill_all()
    msg = f"[parent_plant_slug] done: {stats['updated']} plant(s) updated"
    if stats["ambiguous"]:
        msg += f", {stats['ambiguous']} ambiguous tie(s) logged to {stats['log']}"
    print(msg)


if __name__ == "__main__":
    main()
