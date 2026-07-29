"""Tests for etl/parent_plant_slug.py (GitHub issue #111: backfill
parent_plant_slug for existing cultivars + wire the ETL to populate it
going forward). No test coverage existed for `compute_parent_assignments`/
`backfill_all` before this - the implementer's own outcome comment
verified the matching logic "in-memory" by hand rather than via a
permanent pytest, and explicitly avoided running the full network-
dependent `etl.run` pipeline just to check it. This is that missing
coverage, targeting the actual matching function directly."""

import json
from pathlib import Path

import pytest

from etl import parent_plant_slug as pps


def _plant(common_name: str, botanical_name: str) -> dict:
    return {"common_name": common_name, "botanical_name": botanical_name}


class TestNameWords:
    def test_splits_and_lowercases(self) -> None:
        assert pps._name_words("Brandywine Tomato") == frozenset({"brandywine", "tomato"})

    def test_none_returns_empty(self) -> None:
        assert pps._name_words(None) == frozenset()

    def test_strips_punctuation_from_within_a_word_rather_than_dropping_the_whole_word(self) -> None:
        """The real bug hit during development: 'Eggplant, Black Beauty'
        must yield {'eggplant', 'black', 'beauty'} - an earlier
        w.isalnum()-filtering version silently discarded the whole
        comma-attached token instead of stripping the punctuation, which
        spuriously turned two duplicate-stub records (black-beauty-
        eggplant.json / eggplant-black-beauty.json, same plant, reversed
        word order) into a false parent/child pair."""
        assert pps._name_words("Eggplant, Black Beauty") == frozenset({"eggplant", "black", "beauty"})


class TestComputeParentAssignments:
    def test_a_cultivar_links_to_its_species_via_a_common_name_subset(self) -> None:
        plants = {
            "tomato": _plant("Tomato", "Solanum lycopersicum"),
            "brandywine-tomato": _plant("Brandywine Tomato", "Solanum lycopersicum"),
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert assignments == {"brandywine-tomato": "tomato"}
        assert ambiguous == []

    def test_agriculturally_distinct_crops_sharing_a_botanical_species_are_not_linked(self) -> None:
        """The exact real-world trap this module's own docstring warns
        about: broccoli/cabbage/cauliflower are all Brassica oleracea but
        are NOT cultivars of one another - their common names don't
        overlap, so botanical grouping alone must not link them."""
        plants = {
            "broccoli": _plant("Broccoli", "Brassica oleracea"),
            "cabbage": _plant("Cabbage", "Brassica oleracea"),
            "cauliflower": _plant("Cauliflower", "Brassica oleracea"),
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert assignments == {}
        assert ambiguous == []

    def test_a_two_level_chain_picks_the_more_specific_intermediate_parent(self) -> None:
        """A cultivar of a cultivar - the most specific (largest word-set)
        candidate wins, not the most generic one it also subset-matches."""
        plants = {
            "tomato": _plant("Tomato", "Solanum lycopersicum"),
            "cherry-tomato": _plant("Cherry Tomato", "Solanum lycopersicum"),
            "bonnie-little-bing-cherry-tomato": _plant(
                "Bonnie Little Bing Compact Cherry Tomato", "Solanum lycopersicum"
            ),
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert assignments["cherry-tomato"] == "tomato"
        assert assignments["bonnie-little-bing-cherry-tomato"] == "cherry-tomato"
        assert ambiguous == []

    def test_two_equally_specific_candidates_are_logged_as_ambiguous_not_guessed(self) -> None:
        plants = {
            "red-pepper": _plant("Red Pepper", "Capsicum annuum"),
            "sweet-pepper": _plant("Sweet Pepper", "Capsicum annuum"),
            "red-sweet-pepper": _plant("Red Sweet Pepper", "Capsicum annuum"),
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert "red-sweet-pepper" not in assignments
        assert len(ambiguous) == 1
        entry = ambiguous[0]
        assert entry["slug"] == "red-sweet-pepper"
        assert set(entry["candidate_parents"]) == {"red-pepper", "sweet-pepper"}

    def test_plurals_are_deliberately_not_linked(self) -> None:
        """'Carrots' and 'Carrot' don't share an exact word token - a
        deliberate conservatism (near-duplicate-stub data quality issue,
        not a cultivar relationship) per the module's own docstring."""
        plants = {
            "carrot": _plant("Carrot", "Daucus carota"),
            "carrots": _plant("Carrots", "Daucus carota"),
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert assignments == {}
        assert ambiguous == []

    def test_different_botanical_species_are_never_grouped_together_at_all(self) -> None:
        plants = {
            "tomato": _plant("Tomato", "Solanum lycopersicum"),
            "brandywine-tomato": _plant("Brandywine Tomato", "Solanum lycopersicum"),
            "carrot": _plant("Carrot", "Daucus carota"),
        }
        assignments, _ = pps.compute_parent_assignments(plants)
        assert "carrot" not in assignments

    def test_a_plant_with_no_botanical_name_is_simply_never_grouped(self) -> None:
        plants = {
            "tomato": _plant("Tomato", "Solanum lycopersicum"),
            "brandywine-tomato": {"common_name": "Brandywine Tomato", "botanical_name": None},
        }
        assignments, ambiguous = pps.compute_parent_assignments(plants)
        assert assignments == {}
        assert ambiguous == []


class TestBackfillAll:
    def test_updates_a_genuine_gap_and_writes_it_to_disk(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        (plant_dir / "tomato.json").write_text(
            json.dumps({"slug": "tomato", **_plant("Tomato", "Solanum lycopersicum")}), encoding="utf-8"
        )
        (plant_dir / "brandywine-tomato.json").write_text(
            json.dumps({"slug": "brandywine-tomato", **_plant("Brandywine Tomato", "Solanum lycopersicum")}),
            encoding="utf-8",
        )
        monkeypatch.setattr(pps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(pps, "AMBIGUOUS_LOG", tmp_path / "ambiguous.jsonl")

        stats = pps.backfill_all()

        assert stats["updated"] == 1
        assert stats["ambiguous"] == 0
        data = json.loads((plant_dir / "brandywine-tomato.json").read_text(encoding="utf-8"))
        assert data["parent_plant_slug"] == "tomato"
        # The parent itself is untouched.
        parent_data = json.loads((plant_dir / "tomato.json").read_text(encoding="utf-8"))
        assert parent_data.get("parent_plant_slug") is None

    def test_never_overwrites_an_already_set_parent_plant_slug(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Safe to re-run indefinitely, including as etl.run's own last
        step - a previously-set (possibly manually-curated) value must
        survive every future run untouched."""
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        (plant_dir / "tomato.json").write_text(
            json.dumps({"slug": "tomato", **_plant("Tomato", "Solanum lycopersicum")}), encoding="utf-8"
        )
        (plant_dir / "brandywine-tomato.json").write_text(
            json.dumps(
                {
                    "slug": "brandywine-tomato",
                    **_plant("Brandywine Tomato", "Solanum lycopersicum"),
                    "parent_plant_slug": "some-other-existing-value",
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(pps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(pps, "AMBIGUOUS_LOG", tmp_path / "ambiguous.jsonl")

        stats = pps.backfill_all()

        assert stats["updated"] == 0
        data = json.loads((plant_dir / "brandywine-tomato.json").read_text(encoding="utf-8"))
        assert data["parent_plant_slug"] == "some-other-existing-value"

    def test_re_running_is_idempotent(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        (plant_dir / "tomato.json").write_text(
            json.dumps({"slug": "tomato", **_plant("Tomato", "Solanum lycopersicum")}), encoding="utf-8"
        )
        (plant_dir / "brandywine-tomato.json").write_text(
            json.dumps({"slug": "brandywine-tomato", **_plant("Brandywine Tomato", "Solanum lycopersicum")}),
            encoding="utf-8",
        )
        monkeypatch.setattr(pps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(pps, "AMBIGUOUS_LOG", tmp_path / "ambiguous.jsonl")

        first = pps.backfill_all()
        second = pps.backfill_all()

        assert first["updated"] == 1
        assert second["updated"] == 0
        data = json.loads((plant_dir / "brandywine-tomato.json").read_text(encoding="utf-8"))
        assert data["parent_plant_slug"] == "tomato"

    def test_ambiguous_ties_get_appended_to_the_log_file(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        plant_dir = tmp_path / "plants"
        plant_dir.mkdir()
        for slug, name in [
            ("red-pepper", "Red Pepper"),
            ("sweet-pepper", "Sweet Pepper"),
            ("red-sweet-pepper", "Red Sweet Pepper"),
        ]:
            (plant_dir / f"{slug}.json").write_text(
                json.dumps({"slug": slug, **_plant(name, "Capsicum annuum")}), encoding="utf-8"
            )
        log_path = tmp_path / "ambiguous.jsonl"
        monkeypatch.setattr(pps, "PLANTS_OUT_DIR", plant_dir)
        monkeypatch.setattr(pps, "AMBIGUOUS_LOG", log_path)

        stats = pps.backfill_all()

        assert stats["ambiguous"] == 1
        assert log_path.exists()
        logged = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
        assert logged[0]["slug"] == "red-sweet-pepper"
