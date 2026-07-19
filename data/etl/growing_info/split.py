"""Split a fetched book into candidate sections, then use Ollama to classify
each one against what our data model actually needs (per-plant growing
advice) - deliberately NOT hand-coded heading-pattern regexes, since book
formatting isn't uniform across the 7 books/publishers (verified during
development: some use <h3> with anchor ids per heading like book #43531's
`id="BEANS"`, others (#63013, #46052, #36064) use a mix of h1-h4 with ids
only on a few headings). See data/CLAUDE.md's growing_information section.

Two-step design:
1. `extract_candidate_sections` is a *structural* split, not a content
   heuristic: every HTML heading tag (h1-h4) in the book body delimits a
   section, full stop. This isn't the "regex on heading patterns" the spec
   warns against (that would mean guessing which headings look like plant
   names) - it's just "chunk the book at its own heading tags", which is
   necessary before anything (Ollama included) can classify pieces of a
   500KB+ page individually. All 7 books use h1-h4 consistently for
   structure (verified during development), even though *which* level a
   given plant heading uses varies (h3 in most books, but a flat h1 list in
   #63013).
2. `classify_section` hands each non-trivial candidate to Ollama, which is
   what actually decides "is this per-plant growing content" - this is what
   filters out front/back matter (TOC, illustration lists, insecticide
   recipes, chapter dividers with no content of their own) without any
   book-specific exclusion list.
"""

import json
from dataclasses import dataclass

import httpx

from etl.config import settings
from etl.growing_info.fetch import Book

_HEADING_TAGS = ("h1", "h2", "h3", "h4")

# Below this many characters of actual paragraph text, a "section" is either
# a pure structural divider (a chapter number with its real content living
# under child headings) or a TOC/illustration-list entry - not worth an
# Ollama call either way. Nothing is discarded by this cutoff: if a heading
# has real content, that content lives in its own paragraphs and clears this
# bar; if it doesn't, there is no content to lose.
_MIN_SECTION_CHARS = 80

# Long sections (e.g. book #63013's insecticide chapter) get truncated for
# the classification prompt - classification just needs to recognize
# "this is about a specific plant", not read the whole thing.
_MAX_CLASSIFY_CHARS = 3000


@dataclass
class Section:
    book_id: str
    index: int
    heading_text: str
    anchor_id: str | None
    text: str


def extract_candidate_sections(book: Book) -> list[Section]:
    headings = book.soup.find_all(_HEADING_TAGS)
    sections: list[Section] = []
    for i, heading in enumerate(headings):
        heading_text = heading.get_text(" ", strip=True)
        anchor_id = heading.get("id") or _child_anchor_id(heading)

        # Identity (id()), not bs4 Tag equality: Tag.__eq__ compares
        # structure (name/attrs/contents), so two structurally-identical
        # empty headings would otherwise be treated as interchangeable and
        # could stop the scan at the wrong one.
        next_heading_ids = {id(h) for h in headings[i + 1:]}
        paragraphs: list[str] = []
        for sib in heading.find_all_next():
            if id(sib) in next_heading_ids:
                break
            if sib.name == "p":
                paragraphs.append(sib.get_text(" ", strip=True))
        text = "\n\n".join(p for p in paragraphs if p)

        if len(text) < _MIN_SECTION_CHARS:
            continue
        sections.append(
            Section(book_id=book.book_id, index=i, heading_text=heading_text, anchor_id=anchor_id, text=text)
        )
    return sections


def _child_anchor_id(heading) -> str | None:
    a = heading.find("a")
    return a.get("id") if a else None


# Model choice: mistral-small:latest, same as the rest of this ETL
# (ollama_resolve.py) - this task needs reliable strict-JSON adherence over
# a few hundred calls far more than broad world knowledge, and this model is
# already proven on that axis in this codebase. See ollama_resolve.py's
# module docstring for the fuller reasoning; not re-litigated per-module.
_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "is_plant_content": {
            "type": "boolean",
            "description": "true only if this passage gives growing/cultivation advice about one specific edible or garden plant",
        },
        "plant_name_guess": {
            "type": ["string", "null"],
            "description": "the plant's common name as best you can tell from the heading/text, or null",
        },
    },
    "required": ["is_plant_content", "plant_name_guess"],
}


def classify_section(section: Section) -> tuple[bool, str | None]:
    """Returns (is_plant_content, plant_name_guess). Errs toward including a
    section if Ollama is unreachable or returns something unusable - the
    downstream matching stage (match.py) is a second, independent filter
    (no match -> goes to the unmatched list, not silently dropped), so a
    classification false-positive here is cheap; a false negative would
    silently lose real growing advice, which is worse."""
    prompt = (
        "You are reviewing one section of an old (public-domain) gardening "
        "book to build a garden-plant database. Here is one section:\n\n"
        f"HEADING: {section.heading_text}\n\n"
        f"TEXT:\n{section.text[:_MAX_CLASSIFY_CHARS]}\n\n"
        "Is this section specifically growing/cultivation advice about ONE "
        "particular edible or garden plant (e.g. how to sow, plant, feed, "
        "harvest, or store it)? Answer false for: tables of contents, "
        "illustration lists, prefaces, general gardening topics not tied to "
        "one plant (e.g. fertilizers in general, tools, insect poisons), "
        "indices, advertisements, or the Project Gutenberg license text. "
        'Respond with JSON only: {"is_plant_content": true or false, '
        '"plant_name_guess": "<common name>" or null}.'
    )
    try:
        resp = httpx.post(
            f"{settings.ollama_host}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": prompt,
                "format": _CLASSIFY_SCHEMA,
                "stream": False,
                "options": {"temperature": 0.0},
            },
            timeout=180,
        )
        resp.raise_for_status()
        parsed = json.loads(resp.json()["response"])
        return bool(parsed["is_plant_content"]), parsed.get("plant_name_guess")
    except Exception as exc:  # noqa: BLE001 - a classification hiccup must never abort the run
        print(f"[split] classify failed for {section.book_id}#{section.anchor_id!r} ({exc!r}); including it, letting match.py decide")
        return True, section.heading_text
