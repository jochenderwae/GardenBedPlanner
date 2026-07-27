"""Tests for etl/verify_garden.py (GitHub issue #178's generalization to
also check example_garden_de_heuvel.json's real Planting.geometry shape,
not just the demo fixture's flat x_cm/y_cm points)."""

import pytest

from etl import verify_garden as vg


class TestPlantingPoint:
    def test_flat_point_planting_is_used_directly(self) -> None:
        assert vg._planting_point({"plant_slug": "tomato", "x_cm": 10.0, "y_cm": 20.0}) == (10.0, 20.0)

    def test_real_geometry_planting_uses_its_rectangle_center(self) -> None:
        planting = {
            "plant_slug": "tomato",
            "geometry": {"x": 0.0, "y": 10.0, "type": "rectangle", "width": 20.0, "height": 20.0, "rotation": 0},
        }
        assert vg._planting_point(planting) == (10.0, 20.0)


class TestBedRect:
    def test_rectangle_border_geometry(self) -> None:
        bed = {"name": "Test Bed", "border_geometry": {"type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 50}}
        assert vg._bed_rect(bed) == (0, 0, 100, 50)

    def test_non_rectangle_geometry_returns_none(self, capsys: pytest.CaptureFixture) -> None:
        bed = {"name": "Test Bed", "border_geometry": {"type": "polygon"}}
        assert vg._bed_rect(bed) is None
        assert "SKIPPING" in capsys.readouterr().out


class TestRectanglesOverlap:
    def test_overlapping_rectangles(self) -> None:
        a = {"name": "A", "border_geometry": {"type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 100}}
        b = {"name": "B", "border_geometry": {"type": "rectangle", "x": 50, "y": 50, "width": 100, "height": 100}}
        assert vg._rectangles_overlap(a, b) is True

    def test_adjacent_non_overlapping_rectangles(self) -> None:
        a = {"name": "A", "border_geometry": {"type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 100}}
        b = {"name": "B", "border_geometry": {"type": "rectangle", "x": 100, "y": 0, "width": 100, "height": 100}}
        assert vg._rectangles_overlap(a, b) is False

    def test_far_apart_rectangles(self) -> None:
        a = {"name": "A", "border_geometry": {"type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10}}
        b = {"name": "B", "border_geometry": {"type": "rectangle", "x": 500, "y": 500, "width": 10, "height": 10}}
        assert vg._rectangles_overlap(a, b) is False

    def test_floating_point_adjacent_rectangles_are_not_a_false_positive_overlap(self) -> None:
        """Real case from example_garden_de_heuvel.json: two beds meant to
        sit exactly flush (touching, not overlapping) came back from a
        Postgres round-trip as -170.0 and -170.0000000000001 - a strict
        '<' comparison with no tolerance would call that a real overlap."""
        a = {"name": "A", "border_geometry": {"type": "rectangle", "x": -370.0, "y": 280.0, "width": 200.0, "height": 90.0}}
        b = {
            "name": "B",
            "border_geometry": {
                "type": "rectangle",
                "x": -170.0000000000001,
                "y": 300.00000000000006,
                "width": 70.0,
                "height": 70.0,
            },
        }
        assert vg._rectangles_overlap(a, b) is False


class TestMainAcceptsAPathArgument:
    def test_de_heuvel_fixture_has_no_bed_overlaps(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
    ) -> None:
        """Real regression check for issue #178: the actual de_heuvel
        garden backup must have zero bed-rectangle overlaps. Scoped to
        just OVERLAP findings, not every problem class this tool checks -
        the same real snapshot separately has some pre-existing
        out-of-bed-bounds plantings unrelated to #178's bed-overlap report,
        not something to conflate with or silently paper over here."""
        import sys

        from etl.config import DATA_DIR

        de_heuvel_path = DATA_DIR / "example_garden_de_heuvel.json"
        if not de_heuvel_path.exists():
            return  # nothing to check if the file isn't present in this checkout
        monkeypatch.setattr(sys, "argv", ["verify_garden", str(de_heuvel_path)])
        try:
            vg.main()
        except SystemExit:
            pass
        out = capsys.readouterr().out
        assert "OVERLAP:" not in out, f"unexpected bed overlap(s):\n{out}"
