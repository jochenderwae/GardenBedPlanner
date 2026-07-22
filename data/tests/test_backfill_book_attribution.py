"""Tests for etl/backfill_book_attribution.py (backlog #135). Same
tmp_path-only approach as the other data/tests/ files - never touches real
data/plants/*.json or the real
data/book_attribution_backfill_unmatched.jsonl log.
"""

import json
from pathlib import Path

import pytest

from etl import backfill_book_attribution as bba


class TestBaseUrl:
    def test_strips_fragment(self) -> None:
        assert bba._base_url("https://gutenberg.org/book#SECTION") == "https://gutenberg.org/book"

    def test_url_without_fragment_is_unchanged(self) -> None:
        assert bba._base_url("https://gutenberg.org/book") == "https://gutenberg.org/book"


class TestBookTitlesByUrl:
    def test_maps_base_url_to_attribution(self) -> None:
        titles = bba._book_titles_by_url(
            [{"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "The Vegetable Garden"}]
        )
        assert titles == {"https://gutenberg.org/book1": "The Vegetable Garden"}

    def test_entries_with_the_generic_label_are_not_treated_as_real_titles(self) -> None:
        """A growing_information entry that itself only carries the generic
        'project-gutenberg' label (not yet backfilled, or from a source that
        never got a real title) must not be used as if it were a real book
        title - the whole point is finding the *real* title."""
        titles = bba._book_titles_by_url(
            [{"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "project-gutenberg"}]
        )
        assert titles == {}

    def test_entries_missing_url_or_attribution_are_skipped(self) -> None:
        titles = bba._book_titles_by_url(
            [
                {"source_url": None, "attribution": "Some Book"},
                {"source_url": "https://gutenberg.org/book2", "attribution": None},
                {"attribution": "Some Book"},  # no source_url key at all
            ]
        )
        assert titles == {}

    def test_first_title_wins_when_multiple_entries_share_a_base_url(self) -> None:
        """Two growing_information entries for the same book (different
        #anchors, i.e. different sections) both resolve to the same base
        URL - `setdefault` means whichever is processed first wins, not the
        last. Documents the actual (order-dependent but deterministic given
        a stable input list) behavior."""
        titles = bba._book_titles_by_url(
            [
                {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "First Title Seen"},
                {"source_url": "https://gutenberg.org/book1#POTATO", "attribution": "Second Title Seen"},
            ]
        )
        assert titles == {"https://gutenberg.org/book1": "First Title Seen"}


class TestBackfillPlant:
    def test_fixes_a_generic_attribution_entry_matching_by_base_url(self) -> None:
        data = {
            "slug": "test-tomato",
            "data_sources": [{"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "project-gutenberg"}],
            "growing_information": [
                {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "The Vegetable Garden"}
            ],
        }
        changed, unmatched = bba.backfill_plant(data)
        assert changed == 1
        assert unmatched == []
        assert data["data_sources"][0]["attribution"] == "The Vegetable Garden"

    def test_non_generic_attribution_entries_are_left_untouched(self) -> None:
        data = {
            "slug": "test-tomato",
            "data_sources": [{"source_url": "https://example.com/openfarm", "attribution": "openfarm-crops-rescue"}],
            "growing_information": [],
        }
        changed, unmatched = bba.backfill_plant(data)
        assert changed == 0
        assert unmatched == []
        assert data["data_sources"][0]["attribution"] == "openfarm-crops-rescue"

    def test_generic_attribution_with_no_matching_growing_information_is_logged_unmatched(self) -> None:
        data = {
            "slug": "test-orphan",
            "data_sources": [{"source_url": "https://gutenberg.org/mystery-book", "attribution": "project-gutenberg"}],
            "growing_information": [],
        }
        changed, unmatched = bba.backfill_plant(data)
        assert changed == 0
        assert unmatched == [{"slug": "test-orphan", "source_url": "https://gutenberg.org/mystery-book"}]
        assert data["data_sources"][0]["attribution"] == "project-gutenberg"  # untouched

    def test_generic_attribution_with_no_source_url_at_all_is_logged_unmatched(self) -> None:
        data = {
            "slug": "test-no-url",
            "data_sources": [{"source_url": None, "attribution": "project-gutenberg"}],
            "growing_information": [],
        }
        changed, unmatched = bba.backfill_plant(data)
        assert changed == 0
        assert unmatched == [{"slug": "test-no-url", "source_url": None}]

    def test_multiple_data_sources_entries_resolved_independently(self) -> None:
        data = {
            "slug": "test-multi",
            "data_sources": [
                {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "project-gutenberg"},
                {"source_url": "https://gutenberg.org/book2#POTATO", "attribution": "project-gutenberg"},
                {"source_url": "https://example.com/other", "attribution": "openfarm-crops-rescue"},
            ],
            "growing_information": [
                {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "The Vegetable Garden"},
                {"source_url": "https://gutenberg.org/book2#POTATO", "attribution": "The Potato Book"},
            ],
        }
        changed, unmatched = bba.backfill_plant(data)
        assert changed == 2
        assert unmatched == []
        assert data["data_sources"][0]["attribution"] == "The Vegetable Garden"
        assert data["data_sources"][1]["attribution"] == "The Potato Book"
        assert data["data_sources"][2]["attribution"] == "openfarm-crops-rescue"  # untouched

    def test_plant_with_no_data_sources_or_growing_information_keys_is_a_safe_no_op(self) -> None:
        changed, unmatched = bba.backfill_plant({"slug": "test-bare"})
        assert changed == 0
        assert unmatched == []


class TestMain:
    def test_run_fixes_a_file_and_is_idempotent_on_a_second_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-tomato.json"
        path.write_text(
            json.dumps(
                {
                    "slug": "test-tomato",
                    "common_name": "Test Tomato",
                    "botanical_name": "Testus e2eus",
                    "data_sources": [
                        {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "project-gutenberg"}
                    ],
                    "growing_information": [
                        {"source_url": "https://gutenberg.org/book1#TOMATO", "attribution": "The Vegetable Garden"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(bba, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bba, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bba.main()
        first_run = json.loads(path.read_text(encoding="utf-8"))
        assert first_run["data_sources"][0]["attribution"] == "The Vegetable Garden"
        mtime_after_first_run = path.stat().st_mtime

        # Re-running must be a clean no-op - no further write, since nothing
        # is still generically-attributed.
        bba.main()
        assert path.stat().st_mtime == mtime_after_first_run
        second_run = json.loads(path.read_text(encoding="utf-8"))
        assert second_run["data_sources"][0]["attribution"] == "The Vegetable Garden"

    def test_unmatched_entries_across_files_are_logged(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        (plant_dir / "test-orphan.json").write_text(
            json.dumps(
                {
                    "slug": "test-orphan",
                    "common_name": "Test Orphan",
                    "botanical_name": "Testus e2eus",
                    "data_sources": [
                        {"source_url": "https://gutenberg.org/mystery", "attribution": "project-gutenberg"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(bba, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bba, "UNMATCHED_LOG", unmatched_log)

        bba.main()

        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged == {"slug": "test-orphan", "source_url": "https://gutenberg.org/mystery"}
