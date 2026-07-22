"""Tests for etl/convert_water_needs.py (backlog #137). Same tmp_path-only
approach as test_populate_edible_parts.py - never touches real
data/plants/*.json or the real data/water_needs_conversion_unmatched.jsonl
log.
"""

import json
from pathlib import Path

import pytest

from etl import convert_water_needs as cwn

_MIN_PLANT = {"slug": "test-plant", "common_name": "Test Plant", "botanical_name": "Testus e2eus"}


def _write_plant(path: Path, **overrides: object) -> None:
    data = {**_MIN_PLANT, **overrides}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


class TestParseInPerWeek:
    def test_standard_tilde_pattern(self) -> None:
        assert cwn.parse_in_per_week("~1.0 in/week") == 25.4

    def test_pattern_without_leading_tilde(self) -> None:
        assert cwn.parse_in_per_week("1 in/week") == 25.4

    def test_decimal_rounds_to_one_place(self) -> None:
        # 0.25 * 25.4 = 6.35, which Python's round(_, 1) gives 6.3 for (the
        # implementer's own outcome comment explicitly flags this float-repr
        # quirk - pin it down as a real, deliberate test case rather than
        # letting a future refactor "fix" it into 6.4 unnoticed).
        assert cwn.parse_in_per_week("~0.25 in/week") == 6.3

    def test_whitespace_is_tolerated(self) -> None:
        assert cwn.parse_in_per_week("  ~1.5  in/week  ") == 38.1

    def test_integer_value_without_decimal_point(self) -> None:
        assert cwn.parse_in_per_week("~2 in/week") == 50.8

    def test_non_matching_units_returns_none(self) -> None:
        assert cwn.parse_in_per_week("2 L/week") is None
        assert cwn.parse_in_per_week("moderate") is None
        assert cwn.parse_in_per_week("plenty of water") is None
        assert cwn.parse_in_per_week("") is None

    def test_case_sensitive_unit_suffix_does_not_match(self) -> None:
        # Documents actual behavior (every real value audited before this
        # ETL script was written used lowercase "in/week" - see the
        # module's own docstring) rather than asserting it *should* match;
        # if a future data source introduces "IN/WEEK", this pins down that
        # it would currently be logged unmatched, not silently mis-parsed.
        assert cwn.parse_in_per_week("~1.0 IN/WEEK") is None

    def test_missing_unit_suffix_returns_none(self) -> None:
        assert cwn.parse_in_per_week("~1.0") is None


class TestMainConversion:
    def test_converts_matching_file_and_updates_schema_fields(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path, water_needs="~1.0 in/week")
        monkeypatch.setattr(cwn, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(cwn, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        cwn.main()

        result = json.loads(path.read_text(encoding="utf-8"))
        assert "water_needs" not in result
        assert result["water_needs_mm_per_week"] == 25.4

    def test_plant_with_no_water_needs_field_is_left_alone(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path)  # no water_needs key at all
        monkeypatch.setattr(cwn, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(cwn, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")
        original_mtime = path.stat().st_mtime

        cwn.main()

        assert path.stat().st_mtime == original_mtime  # never rewritten
        result = json.loads(path.read_text(encoding="utf-8"))
        assert "water_needs_mm_per_week" not in result

    def test_unmatched_pattern_is_logged_and_file_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path, water_needs="moderate")
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(cwn, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(cwn, "UNMATCHED_LOG", unmatched_log)

        cwn.main()

        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["water_needs"] == "moderate"  # untouched
        assert "water_needs_mm_per_week" not in result
        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-plant"
        assert logged["raw_value"] == "moderate"
        assert logged["reason"] == "did not match '~N in/week' pattern"

    def test_non_string_water_needs_is_logged_and_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        # additionalProperties: false doesn't forbid a *wrong-typed* known
        # field, so a stray non-string water_needs value (bad data, not a
        # schema violation) is a real edge case the ETL should survive.
        _write_plant(path, water_needs=25.4)
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(cwn, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(cwn, "UNMATCHED_LOG", unmatched_log)

        cwn.main()

        result = json.loads(path.read_text(encoding="utf-8"))
        assert result["water_needs"] == 25.4  # untouched
        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged["reason"] == "not a string"

    def test_multiple_files_processed_independently_in_one_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "a-plant.json", slug="a-plant", water_needs="~1.0 in/week")
        _write_plant(plant_dir / "b-plant.json", slug="b-plant", water_needs="loads")
        _write_plant(plant_dir / "c-plant.json", slug="c-plant")  # no field
        monkeypatch.setattr(cwn, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(cwn, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        cwn.main()

        a = json.loads((plant_dir / "a-plant.json").read_text(encoding="utf-8"))
        b = json.loads((plant_dir / "b-plant.json").read_text(encoding="utf-8"))
        c = json.loads((plant_dir / "c-plant.json").read_text(encoding="utf-8"))
        assert a["water_needs_mm_per_week"] == 25.4
        assert b["water_needs"] == "loads"
        assert "water_needs_mm_per_week" not in c
