"""Match a book section's heading to one of the 359 known plants
(data/plants/*.json - there's no separate master-list data structure, this
IS the master list). Real book headings are messier than structured source
data (e.g. "CETEWAYO OR ZULU POTATOES", "KALE OR BORECOLE" in book #43531),
so per the spec no single strategy is prescribed - this tries three,
cheapest/most-precise first, each only running if the previous one didn't
already produce a confident answer:

1. Fuzzy string match (difflib) between heading/plant_name_guess and each
   plant's common_name - free, catches the easy majority verbatim
   ("CABBAGE." -> "cabbage", "ASPARAGUS" -> "asparagus").
2. Embedding similarity (all-minilm:latest - the one embedding-capable
   model installed locally) narrows the full 359-plant list to a shortlist
   of plausible candidates for messier headings, without needing an exact
   string.
3. Ollama (mistral-small:latest, same reliable-JSON model as
   ollama_resolve.py) picks the single best match from that shortlist, or
   declines - handles cases where the embedding's top hit is a false friend
   (e.g. a heading for a plant genuinely not among our 359 that still
   embeds close to something that is).

Sections that don't match after all three steps are the caller's
responsibility to log to data/growing_info_unmatched.jsonl (run.py) rather
than being discarded - we don't invent new Plant records from book text
alone (per spec).

Cultivar-vs-species handling (find_cultivar_matches): per the cultivar-merge
bug fix in matching.py, cultivars (e.g. "Baby Bear Pumpkin") are separate
Plant records from their species ("pumpkin"/Cucurbita pepo generically).
When a section's matched plant IS a species-level entry, this also returns
any other known plants that are cultivars of the same species (same
normalized botanical name, different slug) - run.py copies the same text
into each of those with generic_for_species=true, per spec.
"""

import difflib
import json
from dataclasses import dataclass

import httpx

from etl.config import PLANTS_OUT_DIR, settings
from etl.growing_info.split import Section
from etl.matching import normalize_botanical, slugify

_FUZZY_THRESHOLD = 0.82


@dataclass
class PlantEntry:
    slug: str
    common_name: str
    botanical_name: str | None
    genus: str | None
    family: str | None


def load_plant_index() -> list[PlantEntry]:
    """The master list of known plants IS the 359 files in data/plants/ -
    there's no separate structure to query (per the task brief). Read
    fresh each time it's called rather than cached at import time, since
    run.py mutates these files as ingestion proceeds and later stages
    (matching subsequent sections, the four passes) should see plants that
    already exist, not a stale snapshot from process start."""
    index = []
    for path in sorted(PLANTS_OUT_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        index.append(
            PlantEntry(
                slug=data["slug"],
                common_name=data["common_name"],
                botanical_name=data.get("botanical_name"),
                genus=data.get("genus"),
                family=data.get("family"),
            )
        )
    return index


def _fuzzy_ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def fuzzy_match(heading_text: str, plant_name_guess: str | None, index: list[PlantEntry]) -> str | None:
    candidates = [slugify(heading_text)]
    if plant_name_guess:
        candidates.append(slugify(plant_name_guess))

    best_slug: str | None = None
    best_ratio = 0.0
    for entry in index:
        entry_slug_form = slugify(entry.common_name)
        for cand in candidates:
            ratio = _fuzzy_ratio(cand, entry_slug_form)
            if entry_slug_form in cand or cand in entry_slug_form:
                # Reward containment (heading "KALE OR BORECOLE" containing
                # "KALE"), but scaled by how much of the longer string the
                # shorter one actually covers - NOT a flat bonus. A flat
                # 0.85 bonus was caught during development mis-firing on
                # "CETEWAYO, OR ZULU, POTATOES." (a plant historically
                # distinct from the common potato): "potato" is a substring
                # of "...potatoes", so it scored a full 0.85 and short-
                # circuited straight to the "potato" slug without ever
                # reaching the embedding+LLM stage that could have caught
                # the mismatch. Scaling by coverage fraction means a short
                # word buried in a long, qualifier-heavy heading no longer
                # gets an undeserved boost, while a heading that's ALMOST
                # entirely the plant name still does.
                shorter, longer = sorted((cand, entry_slug_form), key=len)
                coverage = len(shorter) / len(longer) if longer else 0.0
                ratio = max(ratio, coverage)
            if ratio > best_ratio:
                best_ratio, best_slug = ratio, entry.slug
    return best_slug if best_ratio >= _FUZZY_THRESHOLD else None


# --- embedding similarity -------------------------------------------------

def embed_text(text: str) -> list[float] | None:
    try:
        resp = httpx.post(
            f"{settings.ollama_host}/api/embeddings",
            json={"model": "all-minilm:latest", "prompt": text},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as exc:  # noqa: BLE001
        print(f"[match] embedding call failed for {text[:40]!r}: {exc!r}")
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def build_embedding_index(index: list[PlantEntry]) -> dict[str, list[float]]:
    """One embedding call per known plant (359 total) - cheap and fast for
    all-minilm, and cached to disk by the caller (run.py) so a resumed run
    doesn't redo it."""
    out: dict[str, list[float]] = {}
    for entry in index:
        vec = embed_text(entry.common_name)
        if vec:
            out[entry.slug] = vec
    return out


def shortlist_by_embedding(
    heading_text: str, plant_name_guess: str | None, embedding_index: dict[str, list[float]], k: int = 5
) -> list[str]:
    query = plant_name_guess or heading_text
    query_vec = embed_text(query)
    if not query_vec:
        return []
    scored = [(_cosine(query_vec, vec), slug) for slug, vec in embedding_index.items()]
    scored.sort(reverse=True)
    return [slug for _score, slug in scored[:k]]


# --- LLM final pick --------------------------------------------------------

def llm_pick_best(section: Section, plant_name_guess: str | None, candidates: list[PlantEntry]) -> str | None:
    if not candidates:
        return None
    options = {c.slug: c.common_name for c in candidates}
    schema = {
        "type": "object",
        "properties": {
            "matched_slug": {"enum": [*options.keys(), "none"]},
            "reasoning": {"type": "string"},
        },
        "required": ["matched_slug", "reasoning"],
    }
    options_lines = "\n".join(f"- {slug}: {name}" for slug, name in options.items())
    prompt = (
        f"A section of an old gardening book has the heading '{section.heading_text}'"
        f"{f' (guessed plant: {plant_name_guess})' if plant_name_guess else ''}.\n"
        f"First words of the section text: {section.text[:300]!r}\n\n"
        "Which of these known plants (by slug) is this section ABOUT - i.e. "
        "is it the same plant, just spelled/named differently (capitalization, "
        "old spelling, a synonym)?\n"
        f"{options_lines}\n\n"
        "Answer \"none\" if the heading names a genuinely DIFFERENT, "
        "distinctly-named vegetable that merely happens to be closely "
        "related (e.g. the heading is 'Brussels Sprouts' and the closest "
        "option is 'cabbage' - those are different vegetables, so the "
        "correct answer there is \"none\", not \"cabbage\", even though "
        "they're related brassicas with similar growing advice). Being "
        "closely related botanically is NOT enough - only match if a "
        "gardener would call them the same vegetable. Do not force a match. "
        'Respond with JSON only: {"matched_slug": "<slug>" or "none", '
        '"reasoning": "<one sentence>"}.'
    )
    try:
        resp = httpx.post(
            f"{settings.ollama_host}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": prompt,
                "format": schema,
                "stream": False,
                "options": {"temperature": 0.0},
            },
            timeout=180,
        )
        resp.raise_for_status()
        parsed = json.loads(resp.json()["response"])
        matched = parsed.get("matched_slug")
        return matched if matched in options else None
    except Exception as exc:  # noqa: BLE001
        print(f"[match] llm_pick_best failed for {section.heading_text!r}: {exc!r}")
        return None


def match_section(
    section: Section, plant_name_guess: str | None, index: list[PlantEntry], embedding_index: dict[str, list[float]]
) -> str | None:
    slug = fuzzy_match(section.heading_text, plant_name_guess, index)
    if slug:
        return slug

    shortlist_slugs = shortlist_by_embedding(section.heading_text, plant_name_guess, embedding_index)
    if not shortlist_slugs:
        return None
    by_slug = {e.slug: e for e in index}
    candidates = [by_slug[s] for s in shortlist_slugs if s in by_slug]
    return llm_pick_best(section, plant_name_guess, candidates)


def _is_likely_variant_name(species_common_name: str, candidate_common_name: str) -> bool:
    """True if every word of the (generic) species name appears in the
    candidate's own name - e.g. "pumpkin" vs "Baby Bear Pumpkin" (per the
    spec's own example), "beet" vs "Golden Beet". False for "beet" vs
    "Rainbow Chard" or "broccoli" vs "Kale" even though, botanically,
    Rainbow Chard IS Beta vulgaris (same species as beet) and Kale IS
    Brassica oleracea (same species as broccoli) - this is the check that
    keeps normalize_botanical()'s genus+species matching from over-firing
    on species like these two, where different "varieties" are actually
    different VEGETABLES, not mere cultivars of the same crop. Found by
    smoke-testing book #43531: without this check, "BROCCOLI." text was
    propagating to cabbage/cauliflower/kale/kohlrabi/collard-greens, and
    "BEETS." text to rainbow-chard/swiss-chard - all wrong."""
    species_words = set(slugify(species_common_name).split("-"))
    candidate_words = set(slugify(candidate_common_name).split("-"))
    return bool(species_words) and species_words.issubset(candidate_words)


def find_cultivar_matches(matched_slug: str, index: list[PlantEntry]) -> list[str]:
    """Other known plants that are cultivars of the SAME species as
    matched_slug: same normalized botanical name AND matched_slug's own
    common name is a word-subset of the candidate's name (see
    _is_likely_variant_name) - text that generically describes the species
    gets copied into these too, per spec, marked generic_for_species=true
    rather than treated as a match on its own account. Returns [] if
    matched_slug's botanical_name is missing or nothing qualifies (the
    common case)."""
    by_slug = {e.slug: e for e in index}
    matched = by_slug.get(matched_slug)
    if not matched or not matched.botanical_name:
        return []
    norm = normalize_botanical(matched.botanical_name)
    if not norm:
        return []
    return [
        e.slug
        for e in index
        if e.slug != matched_slug
        and normalize_botanical(e.botanical_name) == norm
        and _is_likely_variant_name(matched.common_name, e.common_name)
    ]
