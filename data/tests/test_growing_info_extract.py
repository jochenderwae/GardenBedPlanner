"""Tests for etl/growing_info/passes.py's extract pass (backlog #127:
"Retrieve periods from growing information", extending the original #59
field set with periods/edible_parts/soil_type/spread_cm/row_spacing_cm).
Mocks passes._extract_fields_via_ollama and passes.resolve_scalar_field
throughout - no real Ollama server needed."""

import pytest

from etl.growing_info import passes


def _plant(slug: str, text: str = "some raw growing-info text", **fields: object) -> dict:
    data = {
        "slug": slug,
        "common_name": slug.replace("-", " ").title(),
        "botanical_name": "Testus e2eus",
        "growing_information": [{"text": text, "record_type": "raw", "attribution": "book-0"}],
    }
    data.update(fields)
    return data


_EMPTY_EXTRACTION = {
    "composting_needs": None,
    "fertilizer_needs": None,
    "needs_wind_cover": None,
    "needs_rain_cover": None,
    "seed_pretreatment": None,
    "bedding_needs": None,
    "soil_type": None,
    "spread_cm": None,
    "row_spacing_cm": None,
    "edible_parts": None,
    "periods": None,
}


def _extraction(**overrides: object) -> dict:
    return {**_EMPTY_EXTRACTION, **overrides}


class TestExtractPassBasics:
    def test_no_growing_information_text_returns_empty_without_calling_ollama(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        called = False

        def _fake(*args: object, **kwargs: object) -> dict:
            nonlocal called
            called = True
            return _extraction()

        monkeypatch.setattr(passes, "_extract_fields_via_ollama", _fake)
        plant = _plant("test-plant", text="")
        plant["growing_information"] = []
        assert passes.extract_pass(plant) == []
        assert called is False

    def test_a_failed_extraction_call_returns_empty_and_does_not_mutate_the_plant(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: {})
        plant = _plant("test-plant")
        assert passes.extract_pass(plant) == []
        assert "soil_type" not in plant


class TestExtractPassScalarFields:
    def test_a_field_missing_entirely_is_set_directly_when_extracted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(soil_type="loam"))
        plant = _plant("test-plant")
        changed = passes.extract_pass(plant)
        assert changed == ["soil_type"]
        assert plant["soil_type"] == "loam"

    def test_extracted_value_matching_the_existing_one_is_a_no_op(self, monkeypatch: pytest.MonkeyPatch) -> None:
        called_resolve = False

        def _fake_resolve(*args: object, **kwargs: object):
            nonlocal called_resolve
            called_resolve = True
            return ("should not be used", "n/a")

        monkeypatch.setattr(passes, "resolve_scalar_field", _fake_resolve)
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(soil_type="loam"))
        plant = _plant("test-plant", soil_type="loam")
        changed = passes.extract_pass(plant)
        assert changed == []
        assert plant["soil_type"] == "loam"
        assert called_resolve is False  # identical values never even reach conflict resolution

    def test_a_genuine_conflict_goes_through_resolve_scalar_field_and_wins(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _fake_resolve(slug, common_name, botanical_name, field_name, candidates):
            assert field_name == "row_spacing_cm"
            assert set(candidates) == {(45, "existing-export"), (90, "growing-info-extraction")}
            return (90, "the book's own stated figure is more specific")

        monkeypatch.setattr(passes, "resolve_scalar_field", _fake_resolve)
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(row_spacing_cm=90))
        plant = _plant("test-bell-pepper", row_spacing_cm=45)
        changed = passes.extract_pass(plant)
        assert changed == ["row_spacing_cm"]
        assert plant["row_spacing_cm"] == 90

    def test_a_genuine_conflict_that_resolves_back_to_the_existing_value_is_not_marked_changed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(passes, "resolve_scalar_field", lambda *a, **k: (45, "existing value wins"))
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(row_spacing_cm=90))
        plant = _plant("test-plant", row_spacing_cm=45)
        changed = passes.extract_pass(plant)
        assert changed == []
        assert plant["row_spacing_cm"] == 45

    def test_a_null_extracted_value_for_a_field_never_touches_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(soil_type=None))
        plant = _plant("test-plant", soil_type="existing loam")
        changed = passes.extract_pass(plant)
        assert changed == []
        assert plant["soil_type"] == "existing loam"

    def test_multiple_scalar_fields_extracted_at_once_are_all_reported(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            passes,
            "_extract_fields_via_ollama",
            lambda *a, **k: _extraction(soil_type="loam", spread_cm=30.0),
        )
        plant = _plant("test-plant")
        changed = passes.extract_pass(plant)
        assert set(changed) == {"soil_type", "spread_cm"}
        assert plant["soil_type"] == "loam"
        assert plant["spread_cm"] == 30.0


class TestExtractPassSeedPretreatment:
    def test_seed_pretreatment_is_set_on_a_plant_with_no_seed_info_at_all(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(seed_pretreatment="soak 24h")
        )
        plant = _plant("test-plant")
        changed = passes.extract_pass(plant)
        assert changed == ["seed_info.pretreatment"]
        assert plant["seed_info"]["pretreatment"] == "soak 24h"

    def test_seed_pretreatment_conflict_goes_through_resolve_scalar_field(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(passes, "resolve_scalar_field", lambda *a, **k: ("cold stratify 4 weeks", "book wins"))
        monkeypatch.setattr(
            passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(seed_pretreatment="cold stratify 4 weeks")
        )
        plant = _plant("test-plant", seed_info={"pretreatment": "none needed"})
        changed = passes.extract_pass(plant)
        assert changed == ["seed_info.pretreatment"]
        assert plant["seed_info"]["pretreatment"] == "cold stratify 4 weeks"


class TestExtractPassBeddingNeeds:
    def test_bedding_needs_are_unioned_by_need_type_not_duplicated(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            passes,
            "_extract_fields_via_ollama",
            lambda *a, **k: _extraction(
                bedding_needs=[{"need_type": "staking", "notes": "tall variety"}, {"need_type": "hilling", "notes": None}]
            ),
        )
        plant = _plant("test-plant", bedding_needs=[{"need_type": "staking", "notes": "already noted"}])
        changed = passes.extract_pass(plant)
        assert changed == ["bedding_needs"]  # only "hilling" is genuinely new
        need_types = [b["need_type"] for b in plant["bedding_needs"]]
        assert need_types.count("staking") == 1  # not duplicated
        assert "hilling" in need_types
        # The pre-existing staking entry's own notes are preserved, not
        # overwritten by the extraction's version.
        staking_entry = next(b for b in plant["bedding_needs"] if b["need_type"] == "staking")
        assert staking_entry["notes"] == "already noted"


class TestExtractPassEdibleParts:
    def test_edible_parts_are_set_unioned_and_sorted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(edible_parts=["Root", " leaves "])
        )
        plant = _plant("test-plant", edible_parts=["fruit"])
        changed = passes.extract_pass(plant)
        assert changed == ["edible_parts"]
        assert plant["edible_parts"] == ["fruit", "leaves", "root"]  # lowercased, trimmed, sorted

    def test_edible_parts_already_fully_covered_is_a_no_op(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(passes, "_extract_fields_via_ollama", lambda *a, **k: _extraction(edible_parts=["fruit"]))
        plant = _plant("test-plant", edible_parts=["fruit"])
        changed = passes.extract_pass(plant)
        assert changed == []


class TestExtractPassPeriods:
    def test_a_new_period_type_is_appended(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            passes,
            "_extract_fields_via_ollama",
            lambda *a, **k: _extraction(periods=[{"period_type": "sowing", "start_month": 3, "end_month": 3}]),
        )
        plant = _plant("test-bell-pepper")
        changed = passes.extract_pass(plant)
        assert changed == ["periods"]
        assert plant["periods"] == [{"period_type": "sowing", "start_month": 3, "end_month": 3}]

    def test_an_existing_period_of_the_same_type_is_never_overwritten(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Additive-only per the issue's own design: a growing-info-derived
        guess must never silently replace a period a more authoritative
        structured source already established."""
        monkeypatch.setattr(
            passes,
            "_extract_fields_via_ollama",
            lambda *a, **k: _extraction(periods=[{"period_type": "sowing", "start_month": 5, "end_month": 5}]),
        )
        plant = _plant(
            "test-plant", periods=[{"period_type": "sowing", "start_month": 3, "end_month": 3}]
        )
        changed = passes.extract_pass(plant)
        assert changed == []
        assert plant["periods"] == [{"period_type": "sowing", "start_month": 3, "end_month": 3}]  # untouched

    def test_a_new_period_type_is_still_added_alongside_an_existing_different_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            passes,
            "_extract_fields_via_ollama",
            lambda *a, **k: _extraction(
                periods=[
                    {"period_type": "sowing", "start_month": 5, "end_month": 5},  # duplicate type, skipped
                    {"period_type": "harvesting", "start_month": 8, "end_month": 9},  # new type, added
                ]
            ),
        )
        plant = _plant(
            "test-plant", periods=[{"period_type": "sowing", "start_month": 3, "end_month": 3}]
        )
        changed = passes.extract_pass(plant)
        assert changed == ["periods"]
        assert plant["periods"] == [
            {"period_type": "sowing", "start_month": 3, "end_month": 3},
            {"period_type": "harvesting", "start_month": 8, "end_month": 9},
        ]
