"""Paragraph-layout normalization for growing_information text (issue #119:
"Growing information text layout is inconsistent").

Two distinct kinds of formatting noise showed up in real `raw`
growing_information entries once actually inspected (see
`data/suggestions.md`/`data/CLAUDE.md` for the ingestion pipeline this feeds):

1. **Embedded hard line-wraps inside a single extracted paragraph.** Some
   source books' Gutenberg HTML preserves the original page's line-wrapping
   as literal `\r\n` characters inside one `<p>` tag's text node (not
   separate tags) - `BeautifulSoup.get_text(" ", strip=True)` only inserts
   its separator *between* tags, so these embedded `\r\n` runs survive
   verbatim and land mid-sentence in the exported text (confirmed: 535 of
   674 real raw entries have a literal `\r` character in them, invariably
   mid-word/mid-sentence, never at a real paragraph boundary).
2. **One `<p>` tag per printed line, not per real paragraph**, in at least
   one source book (#43531 confirmed by inspection). `split.py`'s original
   `"\n\n".join(...)` treats every `<p>`-tag boundary as a paragraph break,
   which is correct for books that tag one `<p>` per real paragraph but
   produces a `\n\n` after nearly every line/clause for a per-line-tagged
   book - i.e. mid-sentence double-newlines, not paragraph breaks.

Both are source-formatting accidents, not real paragraph structure, and
per-book tag conventions aren't consistent enough to hand-code a per-book
exception list (same reasoning `split.py`'s own docstring gives for not
hand-coding heading patterns). `reflow_paragraphs` fixes both with one
general heuristic instead: clean each paragraph-tag fragment's internal
whitespace first (fixes #1), then only start a new output paragraph before
the next fragment if the accumulated text so far actually ends in
sentence-terminal punctuation (fixes #2 - a per-line fragment essentially
never happens to end a sentence, so consecutive line-fragments naturally
reflow back together into normal prose, while genuine paragraph-per-`<p>`
books keep their real paragraph breaks intact, since a real paragraph does
end in terminal punctuation).

This can't perfectly recover the *original* paragraph grouping (that
information is genuinely gone once a per-line book's tag boundaries are the
only structural signal available) - it guarantees only what issue #119
actually asked for: no newline mid-sentence, no doubled/tripled blank
lines, and any newline that does appear sits at a real sentence boundary.
"""

import re

# Any run of whitespace (spaces, tabs, \r, \n, or a mix) inside what should
# be one paragraph fragment - collapsed to a single space.
_WHITESPACE_RUN_RE = re.compile(r"\s+")

# A Gutenberg page-scan artifact - "... as follows: [130]" - a bracketed
# original-page-number marker tacked onto the end of a fragment. Stripped
# before checking for a real sentence ending so "high [130]" (no true
# terminal punctuation) isn't mistaken for a paragraph break, and
# "highly. [15]" (real terminal punctuation, just followed by a stray page
# marker) still tests true.
_TRAILING_PAGE_MARK_RE = re.compile(r"\s*\[\s*\d+\s*\]\s*$")

# True sentence end: ./!/? optionally followed by a closing quote/paren.
_SENTENCE_END_RE = re.compile(r"[.!?][\"'’”)\]]*$")


def clean_fragment(text: str) -> str:
    """Collapses all internal whitespace in one paragraph-tag fragment down
    to single spaces - fixes embedded mid-sentence \\r\\n line-wraps without
    touching real content."""
    return _WHITESPACE_RUN_RE.sub(" ", text).strip()


def _ends_paragraph(text: str) -> bool:
    stripped = _TRAILING_PAGE_MARK_RE.sub("", text).rstrip()
    return bool(_SENTENCE_END_RE.search(stripped))


def reflow_paragraphs(fragments: list[str]) -> str:
    """Joins a list of paragraph-tag text fragments (as extracted from a
    book's HTML - each may itself still contain embedded whitespace/newline
    noise) into clean prose: consecutive fragments are merged with a single
    space (continuing the same paragraph) unless the accumulated text so
    far already ends in real sentence-terminal punctuation, in which case
    the next fragment starts a new paragraph (joined with a blank line).
    See module docstring for why tag boundaries alone aren't a reliable
    paragraph signal across all 7 source books."""
    paragraphs: list[str] = []
    current = ""
    for raw_fragment in fragments:
        fragment = clean_fragment(raw_fragment)
        if not fragment:
            continue
        if not current:
            current = fragment
        elif _ends_paragraph(current):
            paragraphs.append(current)
            current = fragment
        else:
            current = f"{current} {fragment}"
    if current:
        paragraphs.append(current)
    return "\n\n".join(paragraphs)


def reflow_stored_text(text: str) -> str:
    """Re-normalizes an *already-stored* growing_information `text` value
    (i.e. one produced by the old, buggy join) rather than a fresh list of
    HTML fragments. The old code joined per-`<p>` fragments with the exact
    literal `"\\n\\n"`, and never introduced that literal substring any
    other way (embedded page-artifact whitespace is always a single `\\n`
    or `\\r\\n`, never a bare doubled `\\n`) - so splitting stored text on
    `"\\n\\n"` reconstructs the original fragment list closely enough to
    run back through `reflow_paragraphs` directly."""
    fragments = text.split("\n\n")
    return reflow_paragraphs(fragments)
