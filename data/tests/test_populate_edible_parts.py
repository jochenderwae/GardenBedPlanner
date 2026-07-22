"""Tests for etl/populate_edible_parts.py (backlog #133). First real pytest
coverage added to data/ - docs/testing-plan.md's Phase 1 Data/ETL section
planned for `data/tests/` mirroring `data/etl/`'s structure; this is that
scaffold's first real test file, not just a stub. Run via `uv run pytest`
from `data/` (pytest added to `data/pyproject.toml`'s dev dependency group
for this).

Deliberately does NOT call `main()` or touch the real `data/plants/*.json`
files - `_process()` takes a `Path` directly and doesn't rely on
`PLANTS_OUT_DIR` internally, so every test here operates on throwaway
`tmp_path` fixture files. `NORMALIZATION_GAPS_LOG`/`UNMATCHED_LOG` are
monkeypatched to `tmp_path` too, so a test run never appends to the real
`data/edible_parts_*.jsonl` logs.
"""

import json
import os
import time
from pathlib import Path

import pytest

from etl import populate_edible_parts as pep

_MIN_PLANT = {"slug": "test-plant", "common_name": "Test Plant", "botanical_name": "Testus e2eus"}


def _write_plant(path: Path, **overrides: object) -> None:
    data = {**_MIN_PLANT, **overrides}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _age_file(path: Path, seconds: float = pep._HOT_FILE_SKIP_SECONDS + 1) -> None:
    """Backdates a file's mtime past the hot-file-skip window - `_write_plant`
    above always produces a file with a "just now" mtime, which every real
    processing test needs to get past before `_process` will touch it."""
    past = time.time() - seconds
    os.utime(path, (past, past))


# --- _normalize_value: pure, deterministic map + per-slug overrides -------


class TestNormalizeValue:
    def test_generic_map_covers_singular_plural_and_synonym_drift(self) -> None:
        assert pep._normalize_value("tomato", "fruit") == "fruit"
        assert pep._normalize_value("tomato", "fruits") == "fruit"
        assert pep._normalize_value("carrot", "root") == "roots"
        assert pep._normalize_value("carrot", "roots") == "roots"
        assert pep._normalize_value("celery", "stalks") == "stems"
        assert pep._normalize_value("celery", "leaf stems") == "stems"
        assert pep._normalize_value("onion", "onions") == "bulbs"
        assert pep._normalize_value("shallot-plant", "shallot") == "bulbs"

    def test_case_and_whitespace_insensitive(self) -> None:
        assert pep._normalize_value("tomato", "  Fruits  ") == "fruit"
        assert pep._normalize_value("tomato", "FRUIT") == "fruit"

    def test_unmapped_raw_value_returns_none(self) -> None:
        assert pep._normalize_value("tomato", "something nobody wrote down") is None

    def test_slug_override_wins_over_generic_map(self) -> None:
        # "heads" isn't in the generic map at all - only reachable via a
        # per-slug override, and the *same* raw string resolves differently
        # depending on which plant it's attached to.
        assert pep._normalize_value("cabbage", "heads") == "leaves"
        assert pep._normalize_value("broccoli", "heads") == "flowers"
        assert pep._normalize_value("purple-cauliflower", "heads") == "flowers"

    def test_slug_override_does_not_leak_to_other_plants(self) -> None:
        # A plant with no override entry falls through to the generic map,
        # where "heads" isn't defined - must not silently inherit cabbage's
        # or broccoli's override.
        assert pep._normalize_value("test-plant", "heads") is None

    def test_leek_override_corrects_generic_soft_bulbs_mapping(self) -> None:
        # "soft bulbs" generically means bulbs (see _NORMALIZE_MAP), but
        # leek's own override corrects it to stems (leeks don't form a true
        # bulb) - the override table is checked *before* the generic map.
        assert pep._normalize_value("leek", "soft bulbs") == "stems"
        assert pep._normalize_value("onion", "soft bulbs") == "bulbs"


# --- _process: normalization branch (edible_parts already populated) ------


class TestProcessNormalization:
    def test_normalizes_synonyms_deduplicates_and_orders_canonically(self, tmp_path: Path) -> None:
        path = tmp_path / "test-plant.json"
        # "seeds" and "fruit"/"fruits" both present; "fruits" is a duplicate
        # synonym of "fruit" and must collapse to one entry. Canonical order
        # (_CANONICAL_ORDER) puts fruit before seeds regardless of input order.
        _write_plant(path, edible_parts=["seeds", "fruits", "fruit"])
        _age_file(path)

        outcome = pep._process(path)

        assert outcome == "normalized"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["edible_parts"] == ["fruit", "seeds"]
        assert any(
            ds.get("attribution") == "manual-edible-parts-normalization" for ds in result["data_sources"]
        )

    def test_already_canonical_value_is_left_unchanged_and_not_rewritten(self, tmp_path: Path) -> None:
        path = tmp_path / "test-plant.json"
        _write_plant(path, edible_parts=["roots"])
        _age_file(path)
        original_mtime = path.stat().st_mtime

        outcome = pep._process(path)

        assert outcome == "unchanged"
        # File must not have been rewritten at all - mtime untouched.
        assert path.stat().st_mtime == original_mtime
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["edible_parts"] == ["roots"]
        assert "data_sources" not in result

    def test_unrecognized_raw_value_is_logged_as_a_gap_and_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        gaps_log = tmp_path / "gaps.jsonl"
        monkeypatch.setattr(pep, "NORMALIZATION_GAPS_LOG", gaps_log)
        path = tmp_path / "test-plant.json"
        _write_plant(path, edible_parts=["a totally novel raw value"])
        _age_file(path)

        outcome = pep._process(path)

        assert outcome == "normalization-gap"
        result = json.loads(path.read_text(encoding="utf-8"))
        # Untouched - still the raw, un-normalized value.
        assert result["edible_parts"] == ["a totally novel raw value"]
        assert "data_sources" not in result
        logged = json.loads(gaps_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-plant"
        assert logged["raw_values"] == ["a totally novel raw value"]

    def test_concurrent_edit_between_read_and_write_is_not_clobbered(self, tmp_path: Path) -> None:
        """Simulates another process changing edible_parts between this
        function's initial read and its write-time re-check - the
        "someone else changed it between our read and now" guard in
        `_process`'s normalization branch."""
        path = tmp_path / "test-plant.json"
        _write_plant(path, edible_parts=["fruits"])  # needs normalizing to "fruit"
        _age_file(path)

        original_normalize = pep._normalize_value

        def _mutate_file_then_normalize(slug: str, raw: str) -> str | None:
            # Simulate a concurrent writer changing the file's edible_parts
            # right after _process's own initial read but before its
            # write-time re-check.
            current = json.loads(path.read_text(encoding="utf-8"))
            current["edible_parts"] = ["stems"]
            path.write_text(json.dumps(current), encoding="utf-8")
            return original_normalize(slug, raw)

        pep._normalize_value = _mutate_file_then_normalize
        try:
            outcome = pep._process(path)
        finally:
            pep._normalize_value = original_normalize

        assert outcome == "unchanged"
        result = json.loads(path.read_text(encoding="utf-8"))
        # The concurrent writer's value must survive - our own write must
        # not have clobbered it.
        assert result["edible_parts"] == ["stems"]


# --- _process: hot-file skip ------------------------------------------------


def test_recently_modified_file_is_skipped_without_processing(tmp_path: Path) -> None:
    path = tmp_path / "test-plant.json"
    _write_plant(path, edible_parts=["fruits"])  # would otherwise normalize
    # No _age_file() call - file's mtime is "just now", inside the hot-file
    # window.

    outcome = pep._process(path)

    assert outcome == "skipped-hot"
    result = json.loads(path.read_text(encoding="utf-8"))
    assert result["edible_parts"] == ["fruits"]  # untouched


# --- _process: backfill branch (edible_parts missing entirely) ------------


class TestProcessBackfill:
    def test_backfills_from_ollama_and_tags_the_source(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        path = tmp_path / "test-plant.json"
        _write_plant(path)  # no edible_parts key at all
        _age_file(path)
        monkeypatch.setattr(
            pep, "infer_edible_parts", lambda **kwargs: (["fruit", "seeds"], "clearly a fruiting vegetable")
        )

        outcome = pep._process(path)

        assert outcome == "backfilled"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["edible_parts"] == ["fruit", "seeds"]
        sources = result["data_sources"]
        assert len(sources) == 1
        assert sources[0]["attribution"] == "ollama-edible-parts-inference"
        assert "clearly a fruiting vegetable" in sources[0]["notes"]

    def test_declined_inference_is_logged_unmatched_and_field_stays_unset(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(pep, "UNMATCHED_LOG", unmatched_log)
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)
        monkeypatch.setattr(pep, "infer_edible_parts", lambda **kwargs: (None, "not a food crop - ornamental"))

        outcome = pep._process(path)

        assert outcome == "unmatched"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert "edible_parts" not in result
        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-plant"
        assert logged["reasoning"] == "not a food crop - ornamental"

    def test_concurrent_backfill_between_read_and_write_is_not_clobbered(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)

        def _mutate_file_then_infer(**kwargs: object) -> tuple[list[str] | None, str]:
            current = json.loads(path.read_text(encoding="utf-8"))
            current["edible_parts"] = ["roots"]
            path.write_text(json.dumps(current), encoding="utf-8")
            return ["fruit"], "would have said fruit"

        monkeypatch.setattr(pep, "infer_edible_parts", _mutate_file_then_infer)

        outcome = pep._process(path)

        assert outcome == "unchanged"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["edible_parts"] == ["roots"]
