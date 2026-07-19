"""Project Gutenberg book fetcher for long-form growing-advice text.

Each book is one full-page HTML fetch - a one-time bulk fetch like USDA
PLANTS or Wikipedia's companion-plants page in the main pipeline, not a
per-item query, so a light shared RateLimiter (not a real throttle
requirement) is enough; see data/etl/CLAUDE.md's requirement-4 note for why
only per-item-queried sources need a hard rate limit. Reuses http_client's
disk cache (data/.cache/gutenberg/) so a crash/interruption never re-fetches
a book already retrieved.

This module is intentionally Gutenberg-specific (URL list, its particular
boilerplate markers). The storage side (export.py) is source-agnostic -
see that module's docstring.
"""

from dataclasses import dataclass

from bs4 import BeautifulSoup

from etl.http_client import RateLimiter, fetch_text

SOURCE_NAME = "project-gutenberg"

BOOKS = [
    {"id": "43531", "url": "https://www.gutenberg.org/cache/epub/43531/pg43531-images.html"},
    {"id": "76930", "url": "https://www.gutenberg.org/cache/epub/76930/pg76930-images.html"},
    {"id": "7123", "url": "https://www.gutenberg.org/cache/epub/7123/pg7123-images.html"},
    {"id": "36064", "url": "https://www.gutenberg.org/cache/epub/36064/pg36064-images.html"},
    {"id": "77032", "url": "https://www.gutenberg.org/cache/epub/77032/pg77032-images.html"},
    {"id": "63013", "url": "https://www.gutenberg.org/cache/epub/63013/pg63013-images.html"},
    {"id": "46052", "url": "https://www.gutenberg.org/cache/epub/46052/pg46052-images.html"},
]

_limiter = RateLimiter(min_interval_seconds=1.0)


@dataclass
class Book:
    book_id: str
    url: str
    title: str
    copyright_status: str
    soup: BeautifulSoup  # body content only, between the START/END markers


def fetch_book(book_id: str, url: str) -> Book:
    html = fetch_text(url, source=SOURCE_NAME, cache_key=book_id, limiter=_limiter)
    full_soup = BeautifulSoup(html, "lxml")

    title = _extract_title(full_soup, html)
    copyright_status = _extract_copyright(full_soup)
    # html.parser, not lxml, for the sliced body fragment: it deliberately
    # starts mid-document (right after the START marker, typically with a
    # stray closing tag like "</div></header>" before any matching open tag
    # - see _slice_between_markers). lxml's parser returns an EMPTY tree for
    # that malformed-start fragment (discovered during development - 0
    # headings found on a page with 112); Python's built-in html.parser is
    # lenient enough to handle it correctly (110 headings, matching
    # expectations once the 2 header/footer-boilerplate headings are
    # excluded by the slice). Only used for this fragment - full_soup above
    # is a complete, well-formed document, where lxml is fine.
    body_soup = BeautifulSoup(_slice_between_markers(html), "html.parser")

    return Book(book_id=book_id, url=url, title=title, copyright_status=copyright_status, soup=body_soup)


def _extract_title(soup: BeautifulSoup, html: str) -> str:
    heading = soup.find(id="pg-header-heading")
    if heading:
        text = heading.get_text(" ", strip=True)
        # Gutenberg prefixes this heading with "The Project Gutenberg eBook
        # of " - stripped so `attribution` reads as a plain book title.
        prefix = "The Project Gutenberg eBook of "
        if text.startswith(prefix):
            return text[len(prefix):]
        return text
    title_tag = soup.find("title")
    return title_tag.get_text(strip=True) if title_tag else html[:80]


def _extract_copyright(soup: BeautifulSoup) -> str:
    """Project Gutenberg's own license status for THIS page - never the
    original book's own publisher copyright notice further down the page
    (e.g. book #43531 prints a 1912 "All rights reserved" notice from the
    original publisher, which reflects 1912 law and would be misleading if
    copied verbatim; Gutenberg only hosts confirmed-US-public-domain works,
    so its own statement is the one that matters).

    Verified against all 7 books during development (not assumed from
    #43531 alone, per the spec's explicit warning): every one carries a
    structured `<meta name="dc.rights">` tag that Gutenberg's own
    ebookmaker tool generates, and all 7 read identically: "Public domain
    in the USA." That's the primary signal here. The boilerplate paragraph
    in the page header ("This eBook is for the use of anyone anywhere in
    the United States... at no cost and with almost no restrictions
    whatsoever") is also present on all 7 and used as a fallback in case a
    future/different book ever lacks the meta tag.
    """
    meta = soup.find("meta", attrs={"name": "dc.rights"})
    if meta and meta.get("content"):
        return meta["content"].strip()

    header = soup.find(id="pg-header")
    if header:
        for div in header.find_all("div"):
            text = div.get_text(" ", strip=True)
            if "at no cost and with almost no restrictions" in text:
                return text

    return (
        "Project Gutenberg eBook - no explicit rights statement found on "
        "this page; see source_url for licensing terms"
    )


def _slice_between_markers(html: str) -> str:
    """Trims Gutenberg's auto-generated header/footer boilerplate (identical
    scaffolding on every book, not the book's own content) down to just the
    book body, using Gutenberg's own standard START/END markers - verified
    present verbatim on all 7 books during development, not a
    book-specific heuristic. Falls back to the whole page (rather than
    losing content) if a marker is ever missing."""
    start_idx = html.find("*** START OF")
    end_idx = html.find("*** END OF")
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return html
    body_start = html.find("\n", start_idx)
    return html[body_start:end_idx]


def fetch_all() -> list[Book]:
    return [fetch_book(b["id"], b["url"]) for b in BOOKS]
