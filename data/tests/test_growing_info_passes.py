"""Tests for etl/growing_info/passes.py's consolidate pass (backlog #120:
"Consolidated growing information should always use metric measurements")
and the ConsolidationFailed retry-safety fix found while building it.
Mocks `passes._call_ollama` throughout - no real Ollama server needed."""

import json
from pathlib import Path

import pytest

from etl.growing_info import passes


# --- _find_imperial_residuals: the new metric-check heuristic --------------


class TestFindImperialResiduals:
    def test_a_proper_metric_first_conversion_has_no_residual(self) -> None:
        assert passes._find_imperial_residuals("Space plants 30cm (12 inches) apart.") == []

    def test_a_lone_imperial_measurement_with_no_nearby_metric_is_flagged(self) -> None:
        residuals = passes._find_imperial_residuals("Plant the seed 2 inches deep in loose soil.")
        assert len(residuals) == 1
        assert "2 inches" in residuals[0]

    def test_spelled_out_number_words_are_detected(self) -> None:
        residuals = passes._find_imperial_residuals("Set the crown three or four inches below the surface.")
        assert len(residuals) == 1

    def test_feet_and_yards_are_also_detected(self) -> None:
        assert len(passes._find_imperial_residuals("Rows should be 4 feet apart.")) == 1
        assert len(passes._find_imperial_residuals("Allow 2 yards between plants.")) == 1

    def test_metric_only_text_has_no_residuals(self) -> None:
        assert passes._find_imperial_residuals("Space plants 30cm apart in rows 90cm wide.") == []

    def test_multiple_residuals_in_one_text_are_all_found(self) -> None:
        text = "Sow 2 inches deep. Space rows 3 feet apart. Water weekly."
        residuals = passes._find_imperial_residuals(text)
        assert len(residuals) == 2

    def test_a_metric_value_elsewhere_in_a_long_text_does_not_mask_a_distant_imperial_mention(self) -> None:
        """The metric-nearby check uses a small window (default 40 chars) -
        a metric value mentioned far away in the text must not incorrectly
        suppress a real residual close to an unrelated imperial mention."""
        text = "Space rows 30cm apart. " + ("x" * 100) + " Plant seeds 2 inches deep."
        residuals = passes._find_imperial_residuals(text, window=40)
        assert len(residuals) == 1
        assert "2 inches" in residuals[0]


# --- consolidate_pass --------------------------------------------------------


def _plant(slug: str, raw_texts: list[str]) -> dict:
    return {
        "slug": slug,
        "common_name": slug.replace("-", " ").title(),
        "growing_information": [
            {"text": t, "record_type": "raw", "attribution": f"book-{i}"} for i, t in enumerate(raw_texts)
        ],
    }


class TestConsolidatePass:
    def test_fewer_than_two_raw_entries_returns_none_without_calling_ollama(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        called = False

        def _fake_call_ollama(*args: object, **kwargs: object) -> dict:
            nonlocal called
            called = True
            return {"consolidated_text": "should not happen"}

        monkeypatch.setattr(passes, "_call_ollama", _fake_call_ollama)
        assert passes.consolidate_pass(_plant("test-plant", [])) is None
        assert passes.consolidate_pass(_plant("test-plant", ["only one entry"])) is None
        assert called is False

    def test_successful_consolidation_returns_a_correctly_shaped_entry(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            passes, "_call_ollama", lambda *a, **k: {"consolidated_text": "Space plants 30cm (12in) apart."}
        )
        result = passes.consolidate_pass(_plant("test-tomato", ["book one text", "book two text"]))
        assert result is not None
        assert result["text"] == "Space plants 30cm (12in) apart."
        assert result["record_type"] == "consolidated"
        assert "book-0" in result["attribution"] and "book-1" in result["attribution"]
        assert "Ollama synthesis" in result["attribution"]

    def test_empty_consolidated_text_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(passes, "_call_ollama", lambda *a, **k: {"consolidated_text": "   "})
        assert passes.consolidate_pass(_plant("test-plant", ["a", "b"])) is None

    def test_a_clean_metric_conversion_does_not_log_an_imperial_residual(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        residual_log = tmp_path / "residuals.jsonl"
        monkeypatch.setattr(passes, "IMPERIAL_RESIDUAL_LOG", residual_log)
        monkeypatch.setattr(
            passes, "_call_ollama", lambda *a, **k: {"consolidated_text": "Space plants 30cm (12in) apart."}
        )
        passes.consolidate_pass(_plant("test-tomato", ["a", "b"]))
        assert not residual_log.exists()

    def test_a_leftover_imperial_only_mention_is_logged_as_a_residual(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The exact class of miss #120's own outcome comment reports for
        horseradish ("the top two inches below the surface" left
        unconverted)."""
        residual_log = tmp_path / "residuals.jsonl"
        monkeypatch.setattr(passes, "IMPERIAL_RESIDUAL_LOG", residual_log)
        monkeypatch.setattr(
            passes,
            "_call_ollama",
            lambda *a, **k: {"consolidated_text": "Keep the top two inches below the surface."},
        )
        passes.consolidate_pass(_plant("test-horseradish", ["a", "b"]))
        assert residual_log.exists()
        logged = json.loads(residual_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-horseradish"
        assert len(logged["residual_snippets"]) == 1

    def test_ollama_call_failure_raises_consolidation_failed_and_logs_it(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The actual bug this issue's outcome comment fixed (the celery
        timeout incident): a real Ollama-call error must raise
        ConsolidationFailed, distinct from the legitimate "nothing to
        consolidate" None case, and be logged persistently rather than only
        printed."""
        failure_log = tmp_path / "failures.jsonl"
        monkeypatch.setattr(passes, "CONSOLIDATE_FAILURE_LOG", failure_log)

        def _raise(*args: object, **kwargs: object) -> dict:
            raise TimeoutError("simulated Ollama request timeout")

        monkeypatch.setattr(passes, "_call_ollama", _raise)

        with pytest.raises(passes.ConsolidationFailed):
            passes.consolidate_pass(_plant("test-celery", ["a", "b", "c"]))

        assert failure_log.exists()
        logged = json.loads(failure_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-celery"
        assert logged["num_raw_entries"] == 3
        assert "TimeoutError" in logged["error"]

    def test_a_malformed_ollama_response_also_raises_consolidation_failed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing the expected key entirely (e.g. a schema-non-conforming
        response) must be treated the same as a network-level failure -
        still ConsolidationFailed, not an unrelated KeyError escaping."""
        monkeypatch.setattr(passes, "CONSOLIDATE_FAILURE_LOG", tmp_path / "failures.jsonl")
        monkeypatch.setattr(passes, "_call_ollama", lambda *a, **k: {"wrong_key": "oops"})
        with pytest.raises(passes.ConsolidationFailed):
            passes.consolidate_pass(_plant("test-plant", ["a", "b"]))


# --- _sanitize_extracted: adjacent to #120, exercised via consolidate's own
# module (shared "log it, don't guess" spirit) - light coverage since full
# extract_pass coverage belongs to #127. -------------------------------------


class TestSanitizeExtracted:
    def test_literal_null_string_is_normalized_to_none(self) -> None:
        cleaned = passes._sanitize_extracted({"composting_needs": "null", "fertilizer_needs": "well-rotted manure"})
        assert cleaned["composting_needs"] is None
        assert cleaned["fertilizer_needs"] == "well-rotted manure"

    def test_empty_string_is_also_normalized_to_none(self) -> None:
        cleaned = passes._sanitize_extracted({"soil_type": ""})
        assert cleaned["soil_type"] is None

    def test_out_of_range_period_months_are_dropped(self) -> None:
        cleaned = passes._sanitize_extracted(
            {"periods": [{"period_type": "sowing", "start_month": 13, "end_month": 14}]}
        )
        assert cleaned["periods"] == []

    def test_a_valid_period_survives(self) -> None:
        cleaned = passes._sanitize_extracted(
            {"periods": [{"period_type": "sowing", "start_month": 3, "end_month": 4}]}
        )
        assert cleaned["periods"] == [{"period_type": "sowing", "start_month": 3, "end_month": 4}]
