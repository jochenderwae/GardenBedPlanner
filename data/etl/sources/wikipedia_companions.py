"""Wikipedia's "List of companion plants": enrichment only (matched against
the master list by common name), never used to add new plants - it's a
pairing reference, not a curated crop list."""

import re

from bs4 import BeautifulSoup

from etl.http_client import RateLimiter, fetch_text

SOURCE_NAME = "wikipedia-companion-plants"
PAGE_URL = "https://en.wikipedia.org/wiki/List_of_companion_plants"

_limiter = RateLimiter(min_interval_seconds=2.0)

_SPLIT_RE = re.compile(r",|;|\band\b")


def _split_names(cell_text: str) -> list[str]:
    if not cell_text or cell_text.strip() in ("", "-", "—", "none"):
        return []
    return [n.strip() for n in _SPLIT_RE.split(cell_text) if n.strip()]


def fetch_and_parse() -> dict[str, dict]:
    """Returns {common_name_lowercase: {companions: [...], pest_interactions: [...]}}.
    Keyed by common name (not slug) since matching against the master list
    happens in the pipeline, which has both signals available."""
    html = fetch_text(PAGE_URL, source=SOURCE_NAME, cache_key="page", limiter=_limiter)
    soup = BeautifulSoup(html, "lxml")

    results: dict[str, dict] = {}
    for table in soup.select("table.wikitable"):
        header_cells = [
            th.get_text(strip=True).lower() for th in table.select("tr:first-child th")
        ]
        if "common name" not in header_cells:
            continue
        col_index = {name: i for i, name in enumerate(header_cells)}

        for row in table.select("tr")[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < len(header_cells):
                continue
            texts = [c.get_text(" ", strip=True) for c in cells]

            def cell(col_name: str) -> str:
                idx = col_index.get(col_name)
                return texts[idx] if idx is not None and idx < len(texts) else ""

            common_name = cell("common name")
            if not common_name:
                continue
            key = common_name.strip().lower()
            entry = results.setdefault(key, {"companions": [], "pest_interactions": []})

            comments = cell("comments") or None
            for helper in _split_names(cell("helped by")):
                entry["companions"].append(
                    {"companion_slug_hint": helper, "relationship": "good", "notes": comments}
                )
            for avoid in _split_names(cell("avoid")):
                entry["companions"].append(
                    {"companion_slug_hint": avoid, "relationship": "bad", "notes": comments}
                )
            for pest in _split_names(cell("attracts")):
                entry["pest_interactions"].append(
                    {"interaction_type": "attracts", "pest_or_insect": pest}
                )
            repels_col = cell("-repels/+distracts") or cell("repels/distracts") or cell("repels")
            for pest in _split_names(repels_col):
                entry["pest_interactions"].append(
                    {"interaction_type": "repels", "pest_or_insect": pest}
                )

    return results
