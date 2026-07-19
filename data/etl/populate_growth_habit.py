"""One-off task: define + populate `growth_habit`, a small rendering-oriented
plant-shape category (upright / spreading / climbing / rosette / tree) that
the WYSIWYG bed editor uses to draw each plant as something more meaningful
than a generic circle. See plant.schema.json's `growth_habit` description
for the full category definitions and why this list was chosen.

NOT a copy of Trefle's own `growth_habit` field. Trefle's is a free-text,
comma-separated combination of USDA-style values
(main_species.specifications.growth_habit - see data/CLAUDE.md's correction
note; NOT main_species.growth_habit, which is always null in every cached
response) like "Forb/herb", "Tree", "Shrub", "Vine", "Subshrub",
"Graminoid", and combinations. Ours is a small closed enum built by:

1. Deterministic mapping from Trefle's raw growth_habit string where it's
   unambiguous (Tree -> tree, Vine -> climbing, Shrub/Subshrub -> spreading,
   Graminoid -> upright), with a small curated override for known
   ground-sprawling "Vine"-tagged plants (sweet potato, water spinach,
   winter squashes) that garden practice grows sprawling, not trellised.
2. Ollama inference (etl.ollama_resolve.infer_growth_habit - same
   conflict/inference pattern used elsewhere in this pipeline) for
   everything the deterministic mapping can't confidently place: plants
   with no cached Trefle match, a null growth_habit, or a raw value of bare
   "Forb/herb" alone - the single largest bucket by far (116 of ~216
   non-null cached values). Confirmed by spot-checking real cached data
   that bare "Forb/herb" is genuinely ambiguous: tomato/basil/garlic/
   sunflower are "Forb/herb" and clearly upright; carrot/beet/lettuce/
   spinach are "Forb/herb" and clearly rosette/root-form; strawberry is
   "Forb/herb" and clearly spreading (runners). When Trefle said bare
   "Forb/herb", Ollama's choices are constrained to
   {upright, rosette, spreading} - Trefle having positively ruled out
   tree/climbing is a real signal worth keeping, not discarding.

Every populated value is source-tagged in data_sources
("trefle-growth-habit" or "ollama-growth-habit-inference") so the two are
distinguishable later, per task_queue.md's instruction. Plants Ollama
declines to categorize confidently are logged to
growth_habit_unmatched.jsonl and left without the field (schema-optional,
enum includes null) rather than guessed.

Concurrency note: data/plants/*.json is also being actively read-modify-
written by the growing_info background process (task_queue.md's task 3,
running for real in parallel with this one per the 2026-07-18
reprioritization) for its 140 in-scope plants. Two mitigations against
clobbering its writes, since there's no file-locking in this pipeline:
(a) always re-read a plant's file fresh immediately before writing,
applying only this script's own delta on top of whatever's currently on
disk, never a stale in-memory copy from earlier in this run; (b) skip (and
retry at the end of the run) any file whose mtime is within
_HOT_FILE_SKIP_SECONDS of "now" when we're about to touch it - this repo's
own established heuristic for "another process might be mid-write right
now" (see .claude/agents/data-engineer.md's working-style notes). This
doesn't make the race impossible (no locking does that here), but it makes
it very unlikely without adding real infra - flagged in suggestions.md as a
candidate for an actual lock if more concurrent writers show up.

Run from data/: uv run python -m etl.populate_growth_habit
"""

import json
import time
from pathlib import Path

import jsonschema

from etl.config import CACHE_DIR, DATA_DIR, PLANT_SCHEMA_PATH, PLANTS_OUT_DIR
from etl.ollama_resolve import infer_growth_habit

TREFLE_CACHE_DIR = CACHE_DIR / "trefle"
UNMATCHED_LOG = DATA_DIR / "growth_habit_unmatched.jsonl"
_HOT_FILE_SKIP_SECONDS = 5

_ALL_CATEGORIES = ["upright", "spreading", "climbing", "rosette", "tree"]

# Trefle tags these "Vine" (its umbrella term for a climbing/trailing
# stem), but home-garden practice grows them sprawling along the ground
# rather than trellised - curated by hand from the plants actually observed
# with "Vine" in their cached growth_habit during this task's design
# (data/.cache/trefle/*.json), not a general-purpose botanical rule.
_VINE_SPREADING_OVERRIDE = {
    "sweet-potato", "water-spinach", "beach-pea",
    "butternut-squash", "red-kuri-squash", "squash-winter",
}

with open(PLANT_SCHEMA_PATH, encoding="utf-8") as f:
    _SCHEMA = json.load(f)


def _load_trefle_specs(slug: str) -> dict | None:
    path = TREFLE_CACHE_DIR / f"{slug}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    main_species = data.get("main_species")
    if not main_species:
        return None
    return main_species.get("specifications") or {}


def _deterministic_category(slug: str, raw: str) -> tuple[str | None, str]:
    """Returns (category or None, method note). None means: fall through to
    Ollama - either genuinely ambiguous (bare 'Forb/herb') or an unexpected
    combination not seen during the actual survey of cached data this task
    was designed against."""
    segments = {s.strip() for s in raw.split(",") if s.strip()}

    if "Tree" in segments:
        return "tree", f"Trefle growth_habit={raw!r} includes 'Tree'"
    if "Vine" in segments:
        if slug in _VINE_SPREADING_OVERRIDE:
            return "spreading", (
                f"Trefle growth_habit={raw!r} includes 'Vine', but {slug} is a "
                "known ground-sprawling vine (curated override), not a trellised climber"
            )
        return "climbing", f"Trefle growth_habit={raw!r} includes 'Vine'"
    if "Shrub" in segments or "Subshrub" in segments:
        return "spreading", f"Trefle growth_habit={raw!r} includes Shrub/Subshrub"
    if segments == {"Forb/herb"}:
        return None, (
            "Trefle growth_habit is bare 'Forb/herb' - ambiguous between "
            "upright/rosette/spreading, deferred to Ollama"
        )
    if "Graminoid" in segments:
        return "upright", f"Trefle growth_habit={raw!r} is graminoid (grass-like), rendered as upright"
    # Not observed during this task's survey of the actual cached data
    # (only combinations of Forb/herb, Tree, Shrub, Subshrub, Vine,
    # Graminoid were seen) - if Trefle's data has since changed, don't
    # guess, defer to Ollama instead.
    return None, f"Trefle growth_habit={raw!r} - unrecognized combination, deferred to Ollama"


def _growing_info_excerpt(data: dict) -> str | None:
    entries = data.get("growing_information") or []
    consolidated = next((e for e in entries if e.get("record_type") == "consolidated"), None)
    entry = consolidated or (entries[0] if entries else None)
    if not entry:
        return None
    return entry.get("text", "")[:600] or None


def _log_unmatched(slug: str, raw: str | None, reasoning: str) -> None:
    entry = {"slug": slug, "trefle_raw": raw, "reasoning": reasoning}
    with open(UNMATCHED_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[growth-habit] {slug}: UNMATCHED - {reasoning}")


def _process(path: Path) -> str:
    """Returns one of: 'skipped-hot', 'already-set', 'trefle', 'ollama', 'unmatched'."""
    if time.time() - path.stat().st_mtime < _HOT_FILE_SKIP_SECONDS:
        return "skipped-hot"

    data = json.loads(path.read_text(encoding="utf-8"))
    if "growth_habit" in data:
        return "already-set"

    slug = data["slug"]
    specs = _load_trefle_specs(slug)
    raw = (specs or {}).get("growth_habit")

    category: str | None = None
    method = ""
    allowed = _ALL_CATEGORIES
    trefle_signal: str | None = None

    if raw and raw.strip():
        category, method = _deterministic_category(slug, raw)
        if category is None and "Forb/herb" in raw:
            # Herbaceous per Trefle - rule out tree/climbing for the Ollama call.
            allowed = ["upright", "rosette", "spreading"]
            trefle_signal = raw

    if category is not None:
        source_note = {
            "source_url": "https://trefle.io",
            "attribution": "trefle-growth-habit",
            "notes": f"growth_habit={category!r} - {method}",
        }
        outcome = "trefle"
    else:
        deferred_reason = method or "no Trefle growth_habit data (no cached match or null field)"
        resolved, reasoning = infer_growth_habit(
            slug=slug,
            common_name=data.get("common_name", slug),
            botanical_name=data.get("botanical_name"),
            family=data.get("family"),
            description=data.get("description"),
            growing_info_excerpt=_growing_info_excerpt(data),
            allowed_categories=allowed,
            trefle_signal=trefle_signal,
        )
        if resolved is None:
            _log_unmatched(slug, raw, f"{deferred_reason}; Ollama: {reasoning}")
            return "unmatched"
        category = resolved
        source_note = {
            "attribution": "ollama-growth-habit-inference",
            "notes": (
                f"growth_habit={category!r} inferred by Ollama ({deferred_reason}); "
                f"reasoning: {reasoning}"
            ),
        }
        outcome = "ollama"

    # Re-read fresh right before writing - see module docstring's
    # concurrency note. Only apply this script's own delta, never clobber
    # whatever growing_info (or anything else) wrote to this file since our
    # initial read above (which may have been minutes ago if an Ollama call
    # for THIS plant was slow).
    fresh = json.loads(path.read_text(encoding="utf-8"))
    if "growth_habit" in fresh:
        return "already-set"  # someone else set it between our read and now
    fresh["growth_habit"] = category
    fresh.setdefault("data_sources", []).append(source_note)
    jsonschema.validate(fresh, _SCHEMA)
    path.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[growth-habit] {slug}: {category} ({outcome})")
    return outcome


def main() -> None:
    files = sorted(PLANTS_OUT_DIR.glob("*.json"))
    counts: dict[str, int] = {}
    retry: list[Path] = []
    for path in files:
        outcome = _process(path)
        counts[outcome] = counts.get(outcome, 0) + 1
        if outcome == "skipped-hot":
            retry.append(path)

    # Second/third pass for anything skipped as "hot" the first time round
    # (a plant growing_info happened to be mid-write on when we got to it).
    attempts = 0
    while retry and attempts < 3:
        attempts += 1
        time.sleep(_HOT_FILE_SKIP_SECONDS)
        still_hot = []
        for path in retry:
            outcome = _process(path)
            if outcome == "skipped-hot":
                still_hot.append(path)
            else:
                counts[outcome] = counts.get(outcome, 0) + 1
                counts["skipped-hot"] -= 1
        retry = still_hot
    for path in retry:
        print(f"[growth-habit] {path.stem}: still hot after retries, leaving for a future run")

    print(f"[growth-habit] done: {counts}")


if __name__ == "__main__":
    main()
