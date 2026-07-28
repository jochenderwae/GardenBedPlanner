"""Value-level normalization: mapping a source's native vocabulary/units
onto our schema's enums and units. Kept separate from matching.py (which is
about plant *identity*, not field values)."""

import re

_SUN_MAP = {
    "full sun": "full_sun",
    "full": "full_sun",
    "part sun": "half_sun",
    "partial sun": "half_sun",
    "part shade": "half_sun",
    "partial shade": "half_sun",
    "partial": "half_sun",
    "half": "half_sun",
    "full shade": "shadow",
    "shade": "shadow",
}


def map_sun_level(text: str | None) -> str | None:
    if not text:
        return None
    return _SUN_MAP.get(text.strip().lower())


def sun_level_from_light_scale(value: float | None) -> str | None:
    """Trefle's 0-10 light scale -> our 3-value enum. Rough banding, not a
    precise conversion - flagged as a conflict candidate like everything
    else, so Ollama sees it alongside other sources' values rather than
    silently overwriting them."""
    if value is None:
        return None
    if value >= 7:
        return "full_sun"
    if value >= 4:
        return "half_sun"
    return "shadow"


_INCHES_RANGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:\"|in|inch)")
_INCHES_SINGLE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:\"|in|inch)")


def parse_spacing_to_cm(text: str | None) -> float | None:
    """Best-effort: '24-36\" apart' -> average of 24/36 in inches -> cm.
    Returns None (not a guess) if the pattern isn't recognized - better to
    have no candidate value than a silently wrong one."""
    if not text:
        return None
    m = _INCHES_RANGE_RE.search(text)
    if m:
        low, high = float(m.group(1)), float(m.group(2))
        return round((low + high) / 2 * 2.54, 1)
    m = _INCHES_SINGLE_RE.search(text)
    if m:
        return round(float(m.group(1)) * 2.54, 1)
    return None


# Small connector words stay lowercase when not the first word (e.g. "Rose
# of Sharon", not "Rose Of Sharon") - short list since garden-plant common
# names rarely use more than these.
_LOWERCASE_CONNECTORS = {"of", "and", "the", "in", "on", "de", "la"}
_WORD_SPLIT_RE = re.compile(r"(\s+|-|/)")
_FIRST_LETTER_RE = re.compile(r"[a-zA-Z]")

# GitHub issue #161: title_case_plant_name's default lowercase-then-
# recapitalize-first-letter behavior can't tell "source typed this in caps
# because it's an intentional acronym" from "source typed this in caps for
# no particular reason" - the whole ambiguity the function exists to
# resolve for the general case. Both are curated exception lists rather
# than a heuristic, and deliberately small/easy to extend as new plants
# surface more cases (both are currently single-plant-family occurrences
# in real data - "SFG" for the "Square Foot Gardening" cultivar line,
# "UF" for a University of Florida-bred tomato cultivar).
_ACRONYMS = {"SFG", "UF"}

# Same reasoning, for the OTHER direction str.title()-style logic gets
# wrong: a word after an apostrophe defaults to staying lowercase (correct
# for the common possessive case, "bishop's cap" -> "Bishop's cap"), but a
# real proper noun after an apostrophe ("D'Anjou", a pear cultivar named
# for the Anjou region of France) needs its own capital letter too. Keyed
# lowercase for case-insensitive matching against the token as it comes
# out of the default lowercase-then-recapitalize pass.
_APOSTROPHE_PROPER_NOUNS = {"anjou": "Anjou"}


def _fix_apostrophe_proper_nouns(word: str) -> str:
    if "'" not in word:
        return word
    segments = word.split("'")
    fixed = [segments[0]]
    for segment in segments[1:]:
        canonical = _APOSTROPHE_PROPER_NOUNS.get(segment.lower())
        fixed.append(canonical if canonical is not None else segment)
    return "'".join(fixed)


def _capitalize_word(lowered: str) -> str:
    """Capitalizes the first *letter* in the token, not literally index 0 -
    a real bug hit running this against actual data: a token with leading
    punctuation like "(tulsi)" (from "Holy Basil (Tulsi)") has '(' at index
    0, and '('.upper() is a no-op, so the old `lowered[0].upper() +
    lowered[1:]` silently left the real first letter lowercased -
    "(tulsi)" instead of "(Tulsi)". Finding the first a-z/A-Z character and
    capitalizing that one (leaving any leading punctuation untouched) fixes
    this without changing behavior for the common case (no leading
    punctuation), where the first letter IS at index 0."""
    m = _FIRST_LETTER_RE.search(lowered)
    if not m:
        return lowered
    i = m.start()
    return lowered[:i] + lowered[i].upper() + lowered[i + 1:]


def title_case_plant_name(name: str) -> str:
    """Sources disagree wildly on common_name casing ('bitter orange',
    'Adjuma pepper', 'Matariki Taewa Potato' all seen for real in the
    exported data) - normalizes to Title Case consistently.

    Not str.title(): it mis-capitalizes after apostrophes ("bishop's cap"
    -> "Bishop'S Cap"). Splitting on whitespace/hyphen/slash and
    capitalizing only the first letter of each part (leaving the rest
    lowercased, apostrophes included) avoids that, while still capitalizing
    after a hyphen the way a cultivar name like "wai-iti" -> "Wai-Iti"
    needs (and after a slash - "honeydew/specialty" -> "Honeydew/Specialty" -
    found needed against real data: "Melon (Honeydew/Specialty)" would
    otherwise come out "...(Honeydew/specialty)"). Also consults
    _ACRONYMS (preserved uppercase, e.g. "SFG") and
    _APOSTROPHE_PROPER_NOUNS (e.g. "D'Anjou", not "D'anjou") - see GitHub
    issue #161 and those two constants' own comments for why a curated
    exception list, not a heuristic, is the right fix for both."""
    if not name:
        return name
    parts = _WORD_SPLIT_RE.split(name.strip())
    out = []
    word_index = 0
    for part in parts:
        if part == "" or _WORD_SPLIT_RE.fullmatch(part):
            out.append(part)
            continue
        lowered = part.lower()
        if word_index > 0 and lowered in _LOWERCASE_CONNECTORS:
            out.append(lowered)
        elif part.upper() in _ACRONYMS and part.isalpha():
            out.append(part.upper())
        else:
            out.append(_fix_apostrophe_proper_nouns(_capitalize_word(lowered)))
        word_index += 1
    return "".join(out)
