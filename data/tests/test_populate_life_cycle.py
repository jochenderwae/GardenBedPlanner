"""Tests for etl/populate_life_cycle.py (backlog #60). Same tmp_path-only
approach as the other data/tests/ files - never touches real
data/plants/*.json or the real data/life_cycle_unmatched.jsonl log."""

import json
from pathlib import Path

import pytest

from etl import populate_life_cycle as plc

_MIN_PLANT = {"slug": "test-plant", "common_name": "Test Plant", "botanical_name": "Testus e2eus"}


def _write_plant(path: Path, **overrides: object) -> None:
    data = {**_MIN_PLANT, **overrides}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _age_file(path: Path, seconds: float = plc._HOT_FILE_SKIP_SECONDS + 1) -> None:
    import os
    import time

    past = time.time() - seconds
    os.utime(path, (past, past))


class TestGrowingInfoExcerpt:
    def test_no_growing_information_returns_none(self) -> None:
        assert plc._growing_info_excerpt({}) is None
        assert plc._growing_info_excerpt({"growing_information": []}) is None

    def test_prefers_an_entry_that_actually_mentions_a_life_cycle_keyword(self) -> None:
        data = {
            "growing_information": [
                {"text": "Grows well in full sun with rich soil.", "record_type": "raw"},
                {"text": "This is a hardy perennial that returns each spring.", "record_type": "raw"},
            ]
        }
        excerpt = plc._growing_info_excerpt(data)
        assert excerpt is not None
        assert "perennial" in excerpt

    def test_excerpt_is_centered_on_the_keyword_not_always_the_start_of_the_text(self) -> None:
        filler = "x" * 300
        text = f"{filler} this reseeds itself readily each year {filler}"
        data = {"growing_information": [{"text": text, "record_type": "raw"}]}
        excerpt = plc._growing_info_excerpt(data)
        assert excerpt is not None
        assert "reseeds" in excerpt

    def test_falls_back_to_the_consolidated_entry_when_no_entry_mentions_a_keyword(self) -> None:
        data = {
            "growing_information": [
                {"text": "A raw excerpt with no relevant keyword.", "record_type": "raw"},
                {"text": "The consolidated summary text.", "record_type": "consolidated"},
            ]
        }
        excerpt = plc._growing_info_excerpt(data)
        assert excerpt == "The consolidated summary text."

    def test_falls_back_to_the_first_entry_when_no_consolidated_entry_exists_either(self) -> None:
        data = {"growing_information": [{"text": "Only a raw entry here.", "record_type": "raw"}]}
        assert plc._growing_info_excerpt(data) == "Only a raw entry here."

    def test_excerpt_is_capped_at_600_characters(self) -> None:
        data = {"growing_information": [{"text": "y" * 2000, "record_type": "consolidated"}]}
        excerpt = plc._growing_info_excerpt(data)
        assert excerpt is not None
        assert len(excerpt) == 600


class TestProcess:
    def test_recently_modified_file_is_skipped_without_processing(self, tmp_path: Path) -> None:
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        assert plc._process(path) == "skipped-hot"

    def test_a_plant_with_life_cycle_already_set_is_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        called = False

        def _fake_infer(*a: object, **k: object):
            nonlocal called
            called = True
            return ("annual", "should not be called")

        monkeypatch.setattr(plc, "infer_life_cycle", _fake_infer)
        path = tmp_path / "test-plant.json"
        _write_plant(path, life_cycle="perennial")
        _age_file(path)
        assert plc._process(path) == "already-set"
        assert called is False
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["life_cycle"] == "perennial"  # untouched

    def test_declined_inference_is_logged_unmatched_and_field_stays_unset(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(plc, "UNMATCHED_LOG", unmatched_log)
        monkeypatch.setattr(plc, "infer_life_cycle", lambda **k: (None, "tropical species, not applicable"))
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)

        outcome = plc._process(path)

        assert outcome == "unmatched"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert "life_cycle" not in result
        assert "data_sources" not in result
        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged == {"slug": "test-plant", "field": "life_cycle", "reasoning": "tropical species, not applicable"}

    def test_annual_life_cycle_never_calls_infer_life_cycle_years(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _fail_if_called(*a: object, **k: object):
            raise AssertionError("infer_life_cycle_years must not be called for a non-perennial life_cycle")

        monkeypatch.setattr(plc, "infer_life_cycle", lambda **k: ("annual", "clearly annual"))
        monkeypatch.setattr(plc, "infer_life_cycle_years", _fail_if_called)
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)

        outcome = plc._process(path)

        assert outcome == "set"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["life_cycle"] == "annual"
        assert "life_cycle_years" not in result
        assert len(result["data_sources"]) == 1
        assert result["data_sources"][0]["attribution"] == "ollama-life-cycle-inference"

    def test_perennial_with_a_confident_years_figure_sets_both_fields_and_both_source_notes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(plc, "infer_life_cycle", lambda **k: ("perennial", "long-lived shrub"))
        monkeypatch.setattr(plc, "infer_life_cycle_years", lambda **k: (7, "canes typically renewed after 7 years"))
        path = tmp_path / "test-raspberry.json"
        _write_plant(path, slug="test-raspberry")
        _age_file(path)

        outcome = plc._process(path)

        assert outcome == "set"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["life_cycle"] == "perennial"
        assert result["life_cycle_years"] == 7
        attributions = {ds["attribution"] for ds in result["data_sources"]}
        assert attributions == {"ollama-life-cycle-inference", "ollama-life-cycle-years-inference"}

    def test_perennial_with_no_confident_years_figure_sets_only_life_cycle_not_logged_as_a_failure(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A null life_cycle_years for a perennial is the expected common
        case (most perennials have no customary renewal interval) - must
        NOT be logged to UNMATCHED_LOG as if it were a failure."""
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(plc, "UNMATCHED_LOG", unmatched_log)
        monkeypatch.setattr(plc, "infer_life_cycle", lambda **k: ("perennial", "long-lived"))
        monkeypatch.setattr(plc, "infer_life_cycle_years", lambda **k: (None, "no customary renewal interval"))
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)

        outcome = plc._process(path)

        assert outcome == "set"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["life_cycle"] == "perennial"
        assert "life_cycle_years" not in result
        assert len(result["data_sources"]) == 1  # only the life_cycle note, not a years note
        assert not unmatched_log.exists()

    def test_concurrent_edit_between_read_and_write_is_not_clobbered(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(plc, "infer_life_cycle", lambda **k: ("annual", "clearly annual"))
        path = tmp_path / "test-plant.json"
        _write_plant(path)
        _age_file(path)

        # Simulate another process setting life_cycle between our initial
        # read and our write-time re-check: infer_life_cycle runs before
        # _process's own fresh-read-before-write guard, so mutating the
        # file as a side effect of the (mocked) inference call reliably
        # reproduces the race without touching _process's internals.
        def _infer_and_race(**k: object):
            current = json.loads(path.read_text(encoding="utf-8"))
            current["life_cycle"] = "biennial"
            path.write_text(json.dumps(current), encoding="utf-8")
            return ("annual", "would have said annual")

        monkeypatch.setattr(plc, "infer_life_cycle", _infer_and_race)

        outcome = plc._process(path)

        assert outcome == "already-set"
        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["life_cycle"] == "biennial"  # the concurrent writer's value survives
