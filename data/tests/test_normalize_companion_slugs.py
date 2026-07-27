"""Tests for etl/normalize_companion_slugs.py (GitHub issue #164)."""

import json
from pathlib import Path

import pytest

from etl import normalize_companion_slugs as ncs


class TestNormalizeCompanions:
    def test_near_miss_slug_is_renamed(self) -> None:
        companions = [{"companion_slug": "pepper-bell", "relationship": "good"}]
        result, renamed, dangling = ncs.normalize_companions(companions, {"bell-pepper"})
        assert result == [{"companion_slug": "bell-pepper", "relationship": "good"}]
        assert renamed == 1
        assert dangling == []

    def test_real_slug_is_left_untouched(self) -> None:
        companions = [{"companion_slug": "tomato", "relationship": "good"}]
        result, renamed, dangling = ncs.normalize_companions(companions, {"tomato"})
        assert result == companions
        assert renamed == 0
        assert dangling == []

    def test_unrecognized_dangling_slug_is_logged_not_renamed(self) -> None:
        companions = [{"companion_slug": "millet", "relationship": "good"}]
        result, renamed, dangling = ncs.normalize_companions(companions, {"tomato"})
        assert result == companions  # untouched
        assert renamed == 0
        assert dangling == companions

    def test_collision_with_real_slug_already_present_drops_duplicate(self) -> None:
        """The real eggplant.json case: both 'bell-pepper' (real) and
        'pepper-bell' (near-miss of the same plant) present - after
        renaming, the duplicate must be dropped, not kept as two entries
        for the same companion."""
        companions = [
            {"companion_slug": "bell-pepper", "relationship": "good", "notes": "original"},
            {"companion_slug": "pepper-bell", "relationship": "good"},
        ]
        result, renamed, dangling = ncs.normalize_companions(companions, {"bell-pepper"})
        assert result == [{"companion_slug": "bell-pepper", "relationship": "good", "notes": "original"}]
        assert renamed == 1
        assert dangling == []

    def test_collision_detected_regardless_of_entry_order(self) -> None:
        """Same collision as above, but with the near-miss entry listed
        FIRST - must still dedupe down to one entry, keeping whichever
        one is encountered first."""
        companions = [
            {"companion_slug": "pepper-bell", "relationship": "good"},
            {"companion_slug": "bell-pepper", "relationship": "good", "notes": "original"},
        ]
        result, renamed, dangling = ncs.normalize_companions(companions, {"bell-pepper"})
        assert result == [{"companion_slug": "bell-pepper", "relationship": "good"}]
        assert renamed == 1

    def test_mixed_list_of_real_alias_and_dangling(self) -> None:
        companions = [
            {"companion_slug": "tomato", "relationship": "good"},
            {"companion_slug": "pepper-bell", "relationship": "good"},
            {"companion_slug": "millet", "relationship": "bad"},
        ]
        real_slugs = {"tomato", "bell-pepper"}
        result, renamed, dangling = ncs.normalize_companions(companions, real_slugs)
        assert [c["companion_slug"] for c in result] == ["tomato", "bell-pepper", "millet"]
        assert renamed == 1
        assert dangling == [{"companion_slug": "millet", "relationship": "bad"}]


class TestMain:
    def test_updates_a_file_and_tags_data_sources(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        (plant_dir / "bell-pepper.json").write_text(
            json.dumps({"slug": "bell-pepper", "common_name": "Bell Pepper", "botanical_name": "Testus e2eus"}),
            encoding="utf-8",
        )
        (plant_dir / "basil.json").write_text(
            json.dumps(
                {
                    "slug": "basil",
                    "common_name": "Basil",
                    "botanical_name": "Testus e2eus",
                    "companions": [{"companion_slug": "pepper-bell", "relationship": "good"}],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(ncs, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(ncs, "DANGLING_LOG", tmp_path / "dangling.jsonl")

        ncs.main()

        data = json.loads((plant_dir / "basil.json").read_text(encoding="utf-8"))
        assert data["companions"] == [{"companion_slug": "bell-pepper", "relationship": "good"}]
        assert any(ds.get("attribution") == "manual-companion-slug-normalization" for ds in data["data_sources"])

    def test_dangling_reference_is_logged_and_left_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        path = plant_dir / "test-plant.json"
        path.write_text(
            json.dumps(
                {
                    "slug": "test-plant",
                    "common_name": "T",
                    "botanical_name": "T e",
                    "companions": [{"companion_slug": "millet", "relationship": "good"}],
                }
            ),
            encoding="utf-8",
        )
        dangling_log = tmp_path / "dangling.jsonl"
        monkeypatch.setattr(ncs, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(ncs, "DANGLING_LOG", dangling_log)

        ncs.main()

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["companions"] == [{"companion_slug": "millet", "relationship": "good"}]
        assert "data_sources" not in data
        logged = json.loads(dangling_log.read_text(encoding="utf-8").strip())
        assert logged == {"slug": "test-plant", "companion_slug": "millet"}
