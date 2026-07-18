"""Cross-source plant identity matching.

Different sources call the same plant different things ("Tomatoes" vs
"tomato" vs just its binomial name). We need one canonical slug per plant.

Important lesson from the first real test run: botanical-name matching is
NOT safe to use for merging entries *within* a single source's own
listing. openfarm-crops-rescue lists "Acorn Squash", "Zucchini", "Pumpkin",
"Delicata Squash", "Pattypan Squash", and "Spaghetti Squash" as six
genuinely distinct crops - but they're all cultivars of the same species,
Cucurbita pepo. Matching by (genus, species) alone collapsed all six into
one "acorn-squash" record the first time this ran. Sources like Capsicum
chinense (adjuma/habanero/scotch bonnet/datil/fatalii peppers) have the
exact same problem.

Fix: add_distinct() trusts a source's own slugs completely and never
fuzzy-matches - use it for every source's *own* listing. find()/add() (
fuzzy, common-name-first then botanical-name-fallback) exist only for
cross-source linking - checking whether a Homesteader/enrichment-source
record refers to something already in the master list - never for
records from the same pass/source being compared against each other.
"""

import re


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def normalize_botanical(name: str | None) -> str | None:
    """'Cucurbita pepo L.' -> 'cucurbita pepo'. Drops anything after the
    first two words (author citations, subspecies/var. qualifiers) since
    those vary by source and aren't needed for identity matching here."""
    if not name:
        return None
    words = name.strip().split()
    if len(words) < 2:
        return None
    genus, species = words[0], words[1]
    if not genus[0].isupper() or not genus.isalpha() or not species.isalpha():
        return None
    return f"{genus.lower()} {species.lower()}"


class MasterList:
    def __init__(self):
        self.slugs: dict[str, dict] = {}  # slug -> {common_name, botanical_name}
        self._by_botanical: dict[str, str] = {}  # normalized botanical -> slug
        self._by_common: dict[str, str] = {}  # slugified common name -> slug

    def add_distinct(self, slug: str, common_name: str, botanical_name: str | None) -> str:
        """Always creates a new entry - only deduplicates a literal slug
        string collision. Use this for every record in a source's own
        primary listing (openfarm's crops.json against itself, a
        Homesteader crop file against itself): that source has already
        made its own cultivar-vs-species distinctions, and we must not
        second-guess them via fuzzy botanical matching."""
        slug = self._dedupe_slug(slug)
        self._register(slug, common_name, botanical_name)
        return slug

    def add(self, slug: str, common_name: str, botanical_name: str | None) -> str:
        """Fuzzy-matches against EXISTING entries first (common name, then
        botanical name); only adds as new if nothing matches. Use this to
        fold one source's listing into another's (e.g. Homesteader's crop
        files against whatever openfarm already contributed) - never
        within a single source's own listing (see add_distinct)."""
        existing = self.find(common_name, botanical_name)
        if existing:
            return existing
        return self.add_distinct(slug, common_name, botanical_name)

    def find(self, common_name: str | None, botanical_name: str | None) -> str | None:
        """Common name first: two different cultivars of one species
        almost always have different common names, so this is the more
        precise signal. Botanical name is the fallback for when a source
        gives no common name or an very differently-spelled one."""
        if common_name:
            slug_guess = slugify(common_name)
            if slug_guess in self._by_common:
                return self._by_common[slug_guess]
        norm_bot = normalize_botanical(botanical_name)
        if norm_bot and norm_bot in self._by_botanical:
            return self._by_botanical[norm_bot]
        return None

    def _register(self, slug: str, common_name: str, botanical_name: str | None) -> None:
        self.slugs[slug] = {"common_name": common_name, "botanical_name": botanical_name}
        norm_bot = normalize_botanical(botanical_name)
        if norm_bot and norm_bot not in self._by_botanical:
            self._by_botanical[norm_bot] = slug
        self._by_common.setdefault(slugify(common_name), slug)

    def _dedupe_slug(self, slug: str) -> str:
        if slug not in self.slugs:
            return slug
        n = 2
        while f"{slug}-{n}" in self.slugs:
            n += 1
        return f"{slug}-{n}"
