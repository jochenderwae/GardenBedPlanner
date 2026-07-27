"""Tests for etl/backfill_sowing_details.py (GitHub issue #177)."""

import json
from pathlib import Path

import pytest

from etl import backfill_sowing_details as bsd


def _write_plant(path: Path, **overrides: object) -> None:
    data = {"slug": path.stem, "common_name": "Test Plant", "botanical_name": "Testus e2eus", **overrides}
    path.write_text(json.dumps(data), encoding="utf-8")


class TestDeriveSowingDetails:
    def test_indoors_keyword_sets_sow_indoors(self) -> None:
        result = bsd.derive_sowing_details({"sowing_method": "Sow seeds indoors 10-12 weeks before transplanting"})
        assert result == {"sow_indoors": True}

    def test_direct_seed_keyword_sets_sow_direct(self) -> None:
        result = bsd.derive_sowing_details({"sowing_method": "Direct seed outdoors after last frost"})
        assert result == {"sow_direct": True}

    def test_direct_sow_keyword_also_matches(self) -> None:
        result = bsd.derive_sowing_details({"sowing_method": "Direct sow in early spring"})
        assert result == {"sow_direct": True}

    def test_thin_in_sowing_method_sets_needs_thinning(self) -> None:
        result = bsd.derive_sowing_details({"sowing_method": "Direct seed, thin seedlings to 15cm"})
        assert result == {"sow_direct": True, "needs_thinning": True}

    def test_thin_only_in_growing_information_still_matches(self) -> None:
        result = bsd.derive_sowing_details(
            {
                "sowing_method": "Direct seed outdoors",
                "growing_information": [{"text": "Plants should be thinned once well established."}],
            }
        )
        assert result == {"sow_direct": True, "needs_thinning": True}

    def test_no_sowing_method_or_growing_information_yields_nothing(self) -> None:
        assert bsd.derive_sowing_details({}) == {}

    def test_no_matching_keywords_yields_nothing(self) -> None:
        result = bsd.derive_sowing_details({"sowing_method": "Bare root tree"})
        assert result == {}

    def test_both_indoors_and_direct_can_be_true_together(self) -> None:
        """A plant offering multiple valid methods (not a contradiction -
        e.g. 'direct seed or transplant') should get both flags."""
        result = bsd.derive_sowing_details({"sowing_method": "Direct seed or transplant seedlings started indoors"})
        assert result == {"sow_indoors": True, "sow_direct": True}


class TestMain:
    def test_populates_new_fields_and_tags_data_sources(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path, sowing_method="Direct seed, thin to 15cm apart")
        monkeypatch.setattr(bsd, "PLANTS_OUT_DIR", plant_dir)

        bsd.main()

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["sow_direct"] is True
        assert data["needs_thinning"] is True
        assert "sow_indoors" not in data
        assert any(ds.get("attribution") == "manual-sowing-details-derivation" for ds in data["data_sources"])

    def test_existing_value_is_never_overwritten(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path, sowing_method="Direct seed", sow_direct=False)
        monkeypatch.setattr(bsd, "PLANTS_OUT_DIR", plant_dir)

        bsd.main()

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["sow_direct"] is False  # untouched, even though the regex would say True

    def test_plant_with_nothing_derivable_is_left_alone(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        _write_plant(path, sowing_method="Bare root tree")
        monkeypatch.setattr(bsd, "PLANTS_OUT_DIR", plant_dir)

        bsd.main()

        data = json.loads(path.read_text(encoding="utf-8"))
        assert "sow_indoors" not in data
        assert "sow_direct" not in data
        assert "needs_thinning" not in data
        assert "data_sources" not in data
