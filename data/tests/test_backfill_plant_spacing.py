"""Tests for etl/backfill_plant_spacing.py (GitHub issue #170)."""

import json
from pathlib import Path

import pytest

from etl import backfill_plant_spacing as bps


def _write_plant(path: Path, **overrides: object) -> None:
    data = {"slug": path.stem, "common_name": "Test Plant", "botanical_name": "Testus e2eus", **overrides}
    path.write_text(json.dumps(data), encoding="utf-8")


class TestMain:
    def test_manually_derived_plant_gets_its_own_value_not_the_fallback(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "carrot.json", slug="carrot", row_spacing_cm=47)
        monkeypatch.setattr(bps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bps, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bps.main()

        data = json.loads((plant_dir / "carrot.json").read_text(encoding="utf-8"))
        assert data["plant_spacing_cm"] == 10.2
        assert data["plant_spacing_cm"] != data["row_spacing_cm"]
        assert any(ds.get("attribution") == "manual-plant-spacing-derivation" for ds in data["data_sources"])

    def test_plant_without_a_manual_derivation_falls_back_to_row_spacing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-generic.json", row_spacing_cm=30)
        monkeypatch.setattr(bps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bps, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bps.main()

        data = json.loads((plant_dir / "test-generic.json").read_text(encoding="utf-8"))
        assert data["plant_spacing_cm"] == 30
        assert any(ds.get("attribution") == "manual-plant-spacing-fallback" for ds in data["data_sources"])

    def test_plant_with_neither_derivation_nor_row_spacing_is_logged_unmatched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-bare.json")
        unmatched_log = tmp_path / "unmatched.jsonl"
        monkeypatch.setattr(bps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bps, "UNMATCHED_LOG", unmatched_log)

        bps.main()

        data = json.loads((plant_dir / "test-bare.json").read_text(encoding="utf-8"))
        assert data.get("plant_spacing_cm") is None
        logged = json.loads(unmatched_log.read_text(encoding="utf-8").strip())
        assert logged["slug"] == "test-bare"

    def test_plant_with_existing_plant_spacing_cm_is_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-already-set.json"
        original = {
            "slug": "test-already-set",
            "common_name": "T",
            "botanical_name": "T e",
            "row_spacing_cm": 30,
            "plant_spacing_cm": 15,
        }
        path.write_text(json.dumps(original), encoding="utf-8")
        monkeypatch.setattr(bps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(bps, "UNMATCHED_LOG", tmp_path / "unmatched.jsonl")

        bps.main()

        assert json.loads(path.read_text(encoding="utf-8")) == original

    def test_manual_derivations_table_has_no_unknown_slugs(self) -> None:
        """Sanity check the hardcoded table doesn't silently reference a
        plant that no longer exists (e.g. after a rename/merge)."""
        from etl.config import PLANTS_OUT_DIR

        for slug in bps._MANUAL_DERIVATIONS:
            assert (PLANTS_OUT_DIR / f"{slug}.json").exists(), f"{slug} not found in data/plants/"
