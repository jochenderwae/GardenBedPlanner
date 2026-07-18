"""USDA PLANTS Database: one bulk CSV, fetched/parsed once, used purely for
taxonomy (family/genus) enrichment - not cultivation data (the domain notes
call it out as weak there) and never used to extend the master list (it's
all US flora, not garden-relevant curation)."""

import csv
import io

from etl.http_client import RateLimiter, fetch_text

SOURCE_NAME = "usda-plants"
SOURCE_URL = "https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt"

_limiter = RateLimiter(min_interval_seconds=1.0)


def build_taxonomy_index() -> dict[str, dict]:
    """Returns {common_name_lowercase: {"family": ..., "genus": ...}}.
    Only the first family/genus seen per common name is kept (the file has
    many synonym rows per species; first-listed is good enough for our
    purposes - this isn't the authoritative record, just a taxonomy hint)."""
    text = fetch_text(
        SOURCE_URL, source=SOURCE_NAME, cache_key="plantlst", limiter=_limiter
    )
    index: dict[str, dict] = {}
    reader = csv.reader(io.StringIO(text))
    next(reader, None)  # header row
    for row in reader:
        if len(row) < 5:
            continue
        _symbol, _synonym, scientific_name, common_name, family = row[:5]
        if not common_name or not family:
            continue
        key = common_name.strip().lower()
        if key in index:
            continue
        genus = scientific_name.split()[0] if scientific_name else None
        index[key] = {"family": family.strip(), "genus": genus}
    return index
