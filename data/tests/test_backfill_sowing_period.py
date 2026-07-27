"""Tests for etl/backfill_sowing_period.py (GitHub issue #153)."""

import json
from pathlib import Path

import pytest

from etl import backfill_sowing_period as bsp


class TestWeeksToMonths:
    def test_zero_weeks(self) -> None:
        assert bsp._weeks_to_months(0) == 0

    def test_rounds_to_nearest_month(self) -> None:
        assert bsp._weeks_to_months(10) == 2  # 2.30 -> 2
        assert bsp._weeks_to_months(12) == 3  # 2.76 -> 3


class TestSubtractMonths:
    def test_no_wraparound(self) -> None:
        assert bsp._subtract_months(7, 3) == 4

    def test_wraps_around_year_boundary(self) -> None:
        assert bsp._subtract_months(1, 2) == 11
        assert bsp._subtract_months(2, 3) == 11

    def test_zero_offset_is_a_no_op(self) -> None:
        assert bsp._subtract_months(6, 0) == 6


class TestClassifyAnchor:
    def test_transplant_phrase_maps_to_planting(self) -> None:
        assert bsp._classify_anchor("transplanting outdoors") == "planting"

    def test_planting_phrase_maps_to_planting(self) -> None:
        assert bsp._classify_anchor("planting outside") == "planting"

    def test_last_frost_phrase_maps_to_planting(self) -> None:
        assert bsp._classify_anchor("last frost") == "planting"

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert bsp._classify_anchor("the full moon") is None


class TestDeriveSowingPeriod:
    def test_no_sowing_method_is_a_safe_no_op(self) -> None:
        period, reason = bsp.derive_sowing_period({"slug": "test"})
        assert period is None
        assert reason is None

    def test_sowing_method_with_no_lead_time_is_logged_unmatched(self) -> None:
        period, reason = bsp.derive_sowing_period(
            {"slug": "test", "sowing_method": "Direct seed outdoors after last frost"}
        )
        assert period is None
        assert reason is not None

    def test_lead_time_with_unrecognized_anchor_phrase_is_logged_unmatched(self) -> None:
        period, reason = bsp.derive_sowing_period(
            {"slug": "test", "sowing_method": "Sow 4 weeks before the full moon"}
        )
        assert period is None
        assert reason is not None

    def test_lead_time_with_no_matching_period_is_logged_unmatched(self) -> None:
        period, reason = bsp.derive_sowing_period(
            {"slug": "test", "sowing_method": "Sow 8 weeks before transplanting outdoors", "periods": []}
        )
        assert period is None
        assert "planting" in reason

    def test_celery_style_range_derives_a_sensible_window(self) -> None:
        """The real celery.json case: 10-12 weeks before a July-August
        planting period should land in spring (April-June)."""
        data = {
            "slug": "test-celery",
            "sowing_method": "Sow seeds indoors 10-12 weeks before transplanting outdoors",
            "periods": [{"period_type": "planting", "start_month": 7, "end_month": 8}],
        }
        period, reason = bsp.derive_sowing_period(data)
        assert reason is None
        assert period == {"period_type": "sowing", "start_month": 4, "end_month": 6}

    def test_single_lead_value_without_a_range(self) -> None:
        data = {
            "slug": "test-single",
            "sowing_method": "Sow 8 weeks before last frost",
            "periods": [{"period_type": "planting", "start_month": 3, "end_month": 3}],
        }
        period, reason = bsp.derive_sowing_period(data)
        assert reason is None
        assert period == {"period_type": "sowing", "start_month": 1, "end_month": 1}


class TestMain:
    def test_adds_a_sowing_period_and_data_source(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-celery.json"
        path.write_text(
            json.dumps(
                {
                    "slug": "test-celery",
                    "common_name": "Test Celery",
                    "botanical_name": "Testus e2eus",
                    "sowing_method": "Sow seeds indoors 10-12 weeks before transplanting outdoors",
                    "periods": [{"period_type": "planting", "start_month": 7, "end_month": 8}],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(bsp, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bsp, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bsp.main()

        data = json.loads(path.read_text(encoding="utf-8"))
        sowing_periods = [p for p in data["periods"] if p["period_type"] == "sowing"]
        assert sowing_periods == [{"period_type": "sowing", "start_month": 4, "end_month": 6}]
        assert any(ds.get("attribution") == "manual-sowing-period-derivation" for ds in data["data_sources"])

    def test_plant_with_existing_sowing_period_is_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-has-sowing.json"
        original = {
            "slug": "test-has-sowing",
            "common_name": "Test",
            "botanical_name": "Testus e2eus",
            "sowing_method": "Sow 10 weeks before transplanting outdoors",
            "periods": [
                {"period_type": "planting", "start_month": 7, "end_month": 8},
                {"period_type": "sowing", "start_month": 1, "end_month": 1},
            ],
        }
        path.write_text(json.dumps(original), encoding="utf-8")
        monkeypatch.setattr(bsp, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bsp, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bsp.main()

        assert json.loads(path.read_text(encoding="utf-8")) == original

    def test_plant_with_no_sowing_method_is_skipped_not_logged(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-no-sowing-method.json"
        path.write_text(json.dumps({"slug": "test-no-sowing-method", "common_name": "T", "botanical_name": "T e"}), encoding="utf-8")
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(bsp, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bsp, "UNMATCHED_LOG", unmatched_log)

        bsp.main()

        assert not unmatched_log.exists()

    def test_unresolvable_sowing_method_is_logged_unmatched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-vague.json"
        path.write_text(
            json.dumps(
                {
                    "slug": "test-vague",
                    "common_name": "T",
                    "botanical_name": "T e",
                    "sowing_method": "Direct seed outdoors after last frost",
                }
            ),
            encoding="utf-8",
        )
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(bsp, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bsp, "UNMATCHED_LOG", unmatched_log)

        bsp.main()

        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-vague"
