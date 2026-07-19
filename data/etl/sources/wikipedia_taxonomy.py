"""Wikipedia/Wikidata as a taxonomy (family/genus) source - specifically for
backfilling plants the main ETL run left with no family/genus at all (see
data/etl/backfill_taxonomy.py), not part of the main per-plant enrichment
pipeline (run.py's enrich_plant). Deliberately a separate, later pass: most
of the plants missing taxonomy are cultivars (e.g. eight different potato
varieties), and every cultivar of the same species shares one genus - so
this resolves family/genus once per *genus*, not once per plant, then
applies the result to every plant sharing it.

Uses Wikidata rather than parsing Wikipedia's taxobox wikitext directly:
modern Wikipedia taxoboxes (Speciesbox/Automatic taxobox) usually source
family from Wikidata's own taxonomy tree rather than stating it as a
wikitext parameter, so parsing wikitext directly misses exactly the pages
that don't spell it out. Walking Wikidata's P171 (parent taxon) chain from
the genus's item until hitting a P105 (taxon rank) of family (Q35409) is
the same lookup Wikipedia's own infobox does under the hood, done directly.
"""

from etl.http_client import RateLimiter, fetch_json

SOURCE_NAME = "wikipedia-taxonomy"
_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
_WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_FAMILY_RANK_QID = "Q35409"
# Modern Wikidata taxonomy trees insert unranked clades between genus and
# family (verified for real: Phaseolus -> Phaseolinae -> Phaseoleae -> two
# unranked clades -> Fabaceae took 6 parent hops) - 6 undershot this in
# testing, so padded well past the worst case actually observed.
_MAX_PARENT_HOPS = 15

_limiter = RateLimiter(min_interval_seconds=1.0)


def genus_from_botanical_name(botanical_name: str | None) -> str | None:
    """botanical_name usually encodes genus in its first word (see
    backend/app/models/plant.py's own comment on Plant.genus_id) - cheap
    and reliable, so this is tried before ever touching the network.

    Rejects a single-letter-abbreviated first word ("R. raphanistrum" -
    seen for real in the exported data, abbreviated because the source
    listed it alongside other Raphanus entries) rather than looking up the
    literal abbreviation, which would just fail the Wikidata lookup anyway -
    logged as unmatched by the caller like any other unresolvable case."""
    if not botanical_name or not botanical_name.strip():
        return None
    first = botanical_name.strip().split()[0]
    if len(first) <= 2 and first.endswith("."):
        return None
    return first if first[0].isupper() else None


def _wikidata_qid_for_title(title: str) -> str | None:
    data = fetch_json(
        _WIKIPEDIA_API,
        source=SOURCE_NAME,
        cache_key=f"pageprops_{title}",
        limiter=_limiter,
        params={
            "action": "query",
            "titles": title,
            "prop": "pageprops",
            "ppprop": "wikibase_item",
            "format": "json",
            "redirects": 1,
        },
    )
    for page in data.get("query", {}).get("pages", {}).values():
        qid = page.get("pageprops", {}).get("wikibase_item")
        if qid:
            return qid
    return None


def _wikidata_entity(qid: str) -> dict:
    data = fetch_json(
        _WIKIDATA_API,
        source=SOURCE_NAME,
        cache_key=f"entity_{qid}",
        limiter=_limiter,
        params={
            "action": "wbgetentities",
            "ids": qid,
            "props": "claims|labels",
            # "mul" (a pseudo-language Wikidata uses for values that don't
            # vary by language - since ~2023, increasingly used for
            # scientific/taxonomic names instead of "en") must be requested
            # explicitly too - see _label()'s docstring for why "en" alone
            # isn't enough.
            "languages": "en|mul",
            "format": "json",
        },
    )
    return data.get("entities", {}).get(qid, {})


def _claim_target_qid(entity: dict, property_id: str) -> str | None:
    for claim in entity.get("claims", {}).get(property_id, []):
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        qid = value.get("id")
        if qid:
            return qid
    return None


def _label(entity: dict) -> str | None:
    """Real bug hit on real data: Rosaceae's own Wikidata item (Q46299) -
    which both Prunus and Pyrus resolve up to - has NO "en" label at all,
    only "mul" (Wikidata's pseudo-language for values that don't vary by
    language, increasingly used for scientific/taxonomic names) plus dozens
    of other specific languages. "en" alone silently produced None for a
    perfectly good family match, which fetch_family_for_genus then treated
    as "unresolvable" - not a network/API failure, a real gap in what
    counts as this item's English-usable name. Falls back to "mul" (the
    scientific name is language-invariant anyway, so it's exactly what we
    want here) before giving up."""
    labels = entity.get("labels", {})
    return labels.get("en", {}).get("value") or labels.get("mul", {}).get("value")


def fetch_family_for_genus(genus: str) -> dict | None:
    """Returns {"family": <name>, "source_url": <genus's Wikipedia page>}
    or None if the genus's Wikipedia page/Wikidata item/family ancestor
    couldn't be resolved within _MAX_PARENT_HOPS - callers should log these
    as unmatched, not guess (same policy as growing_info's unmatched log)."""
    qid = _wikidata_qid_for_title(genus)
    if not qid:
        return None
    entity = _wikidata_entity(qid)
    for _ in range(_MAX_PARENT_HOPS):
        if _claim_target_qid(entity, "P105") == _FAMILY_RANK_QID:
            family_name = _label(entity)
            if not family_name:
                return None
            return {"family": family_name, "source_url": f"https://en.wikipedia.org/wiki/{genus}"}
        parent_qid = _claim_target_qid(entity, "P171")
        if not parent_qid:
            return None
        entity = _wikidata_entity(parent_qid)
    return None
