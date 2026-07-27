"""Tests for etl/backfill_is_edible.py (GitHub issue #165). Same
monkeypatched-PLANTS_OUT_DIR approach as test_backfill_book_attribution.py -
never touches the real data/plants/*.json files."""

import json
from pathlib import Path

import pytest

from etl import backfill_is_edible as bie


def _write_plant(path: Path, **overrides: object) -> None:
    data = {"slug": path.stem, "common_name": "Test Plant", "botanical_name": "Testus e2eus", **overrides}
    path.write_text(json.dumps(data), encoding="utf-8")


class TestMain:
    def test_fixes_edible_parts_is_edible_contradiction(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-apple.json", edible_parts=["fruit"], is_edible=False)
        monkeypatch.setattr(bie, "PLANTS_OUT_DIR", plant_dir)

        bie.main()

        data = json.loads((plant_dir / "test-apple.json").read_text(encoding="utf-8"))
        assert data["is_edible"] is True
        assert any(ds.get("attribution") == "manual-research" for ds in data["data_sources"])

    def test_plant_with_no_edible_parts_is_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-rock.json", is_edible=False)
        monkeypatch.setattr(bie, "PLANTS_OUT_DIR", plant_dir)

        bie.main()

        data = json.loads((plant_dir / "test-rock.json").read_text(encoding="utf-8"))
        assert data["is_edible"] is False
        assert "data_sources" not in data

    def test_plant_already_is_edible_true_is_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-carrot.json", edible_parts=["roots"], is_edible=True)
        monkeypatch.setattr(bie, "PLANTS_OUT_DIR", plant_dir)

        bie.main()

        data = json.loads((plant_dir / "test-carrot.json").read_text(encoding="utf-8"))
        assert data["is_edible"] is True
        assert "data_sources" not in data

    def test_excluded_slug_is_skipped_even_with_the_contradiction(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "comfrey.json", slug="comfrey", edible_parts=["leaves"], is_edible=False)
        monkeypatch.setattr(bie, "PLANTS_OUT_DIR", plant_dir)

        bie.main()

        data = json.loads((plant_dir / "comfrey.json").read_text(encoding="utf-8"))
        assert data["is_edible"] is False
        assert "data_sources" not in data

    def test_is_edible_unset_with_edible_parts_is_also_fixed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """is_edible missing entirely (not just explicitly false) is the same
        contradiction - edible_parts positively identifies an edible part, so
        a null/unset is_edible should also be corrected to true."""
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        _write_plant(plant_dir / "test-pear.json", edible_parts=["fruit"])
        monkeypatch.setattr(bie, "PLANTS_OUT_DIR", plant_dir)

        bie.main()

        data = json.loads((plant_dir / "test-pear.json").read_text(encoding="utf-8"))
        assert data["is_edible"] is True
