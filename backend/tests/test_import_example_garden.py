"""Tests for app/scripts/import_example_garden.py (backlog #65: "Example-
garden importer should also create a Garden row"). No test coverage
existed for this script at all before - not even the pure geometry
helpers. Uses a small, controlled fixture file (not the real, large
data/example_garden.json) via seed_example_garden()'s own `path`
parameter, so this stays isolated/fast and independent of the real
fixture's exact contents."""

import json
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.models.garden import Garden
from app.models.plant import Plant
from app.scripts.import_example_garden import (
    _beds_bounding_box,
    _geometry_points,
    _rectangle_corners,
    seed_example_garden,
)

pytestmark = pytest.mark.integration


def _rect(x: float, y: float, width: float, height: float, rotation: float = 0) -> dict:
    return {"type": "rectangle", "x": x, "y": y, "width": width, "height": height, "rotation": rotation}


def _fixture(tmp_path: Path, beds: list[dict]) -> Path:
    path = tmp_path / "example_garden.json"
    path.write_text(json.dumps({"beds": beds}), encoding="utf-8")
    return path


class TestRectangleCorners:
    def test_unrotated_rectangle_returns_its_four_plain_corners(self) -> None:
        corners = _rectangle_corners(_rect(0, 0, 100, 50))
        assert corners == [(0, 0), (100, 0), (100, 50), (0, 50)]

    def test_a_90_degree_rotation_swaps_the_bounding_extent(self) -> None:
        """A 100x50 rect rotated 90 degrees around its own center occupies
        a 50-wide x 100-tall footprint in world space - the unrotated
        x/y/width/height box alone would get this wrong."""
        corners = _rectangle_corners(_rect(0, 0, 100, 50, rotation=90))
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        assert max(xs) - min(xs) == pytest.approx(50, abs=1e-6)
        assert max(ys) - min(ys) == pytest.approx(100, abs=1e-6)


class TestGeometryPoints:
    def test_rectangle_geometry_returns_its_corners(self) -> None:
        points = _geometry_points(_rect(10, 20, 30, 40))
        assert len(points) == 4
        assert (10, 20) in points

    def test_polygon_geometry_returns_its_own_points_directly(self) -> None:
        polygon = {"type": "polygon", "points": [{"x": 0, "y": 0}, {"x": 50, "y": 0}, {"x": 25, "y": 50}]}
        assert _geometry_points(polygon) == [(0, 0), (50, 0), (25, 50)]


class TestBedsBoundingBox:
    def test_bounding_box_spans_every_bed(self) -> None:
        beds = [
            {"border_geometry": _rect(0, 0, 100, 100)},
            {"border_geometry": _rect(500, 500, 50, 50)},
        ]
        assert _beds_bounding_box(beds) == (0, 0, 550, 550)

    def test_bounding_box_accounts_for_a_rotated_beds_true_footprint(self) -> None:
        """A bed rotated 90 degrees at origin (0,0) with width=100,
        height=20 occupies world x in [40, 60], y in [-40, 60] (rotating
        around its own center at (50,10)) - the unrotated box would
        wrongly report x in [0,100]."""
        beds = [{"border_geometry": _rect(0, 0, 100, 20, rotation=90)}]
        min_x, min_y, max_x, max_y = _beds_bounding_box(beds)
        assert min_x == pytest.approx(40, abs=1e-6)
        assert max_x == pytest.approx(60, abs=1e-6)
        assert (max_y - min_y) == pytest.approx(100, abs=1e-6)


class TestSeedExampleGardenCreatesGarden:
    def test_first_run_creates_a_garden_bounding_every_bed_with_margin(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        path = _fixture(
            tmp_path,
            [
                {"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)},
                {"name": "Bed B", "border_geometry": _rect(400, 300, 50, 50)},
            ],
        )
        result = seed_example_garden(db_session, path)
        assert result.beds_imported == 2
        assert result.beds_failed == 0

        garden = db_session.exec(select(Garden)).one()
        assert garden.name == "My Garden"
        # Beds span x:[0,450], y:[0,350] - garden adds a 100cm margin on
        # every side (see _GARDEN_MARGIN_CM).
        assert garden.border_geometry == {
            "type": "rectangle",
            "x": -100.0,
            "y": -100.0,
            "width": 450.0 + 200.0,
            "height": 350.0 + 200.0,
            "rotation": 0,
        }

    def test_running_it_twice_does_not_create_a_second_garden_or_change_the_first(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        path = _fixture(tmp_path, [{"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)}])
        seed_example_garden(db_session, path)
        first_garden = db_session.exec(select(Garden)).one()
        first_id = first_garden.id

        seed_example_garden(db_session, path)
        gardens = list(db_session.exec(select(Garden)).all())
        assert len(gardens) == 1
        assert gardens[0].id == first_id
        assert gardens[0].border_geometry == first_garden.border_geometry

    def test_a_pre_existing_real_garden_is_never_overwritten(self, db_session: Session, tmp_path: Path) -> None:
        """A user's own real Garden (their own custom boundary/name/
        orientation) must survive the importer untouched, even if it looks
        nothing like what the fixture beds would bound - this is the "get,
        not create-or-update" half of the get-or-create semantics."""
        real_garden = Garden(
            name="The Derwae Family Garden",
            border_geometry=_rect(1000, 1000, 2000, 2000),
            orientation_deg=45.0,
            notes="my real garden, please don't touch",
        )
        db_session.add(real_garden)
        db_session.commit()
        real_garden_id = real_garden.id

        path = _fixture(tmp_path, [{"name": "Bed A", "border_geometry": _rect(0, 0, 100, 100)}])
        seed_example_garden(db_session, path)

        gardens = list(db_session.exec(select(Garden)).all())
        assert len(gardens) == 1
        assert gardens[0].id == real_garden_id
        assert gardens[0].name == "The Derwae Family Garden"
        assert gardens[0].notes == "my real garden, please don't touch"
        assert gardens[0].orientation_deg == 45.0

    def test_polygon_bed_geometry_contributes_its_own_points_to_the_garden_bounding_box(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        path = _fixture(
            tmp_path,
            [
                {
                    "name": "Polygon Bed",
                    "border_geometry": {
                        "type": "polygon",
                        "points": [{"x": 0, "y": 0}, {"x": 300, "y": 0}, {"x": 150, "y": 250}],
                    },
                }
            ],
        )
        seed_example_garden(db_session, path)
        garden = db_session.exec(select(Garden)).one()
        assert garden.border_geometry["x"] == -100.0
        assert garden.border_geometry["y"] == -100.0
        assert garden.border_geometry["width"] == 300.0 + 200.0
        assert garden.border_geometry["height"] == 250.0 + 200.0

    def test_missing_fixture_file_raises_file_not_found(self, db_session: Session, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            seed_example_garden(db_session, tmp_path / "does-not-exist.json")

    def test_a_bed_with_a_planting_referencing_a_real_plant_imports_correctly_alongside_the_garden(
        self, db_session: Session, tmp_path: Path
    ) -> None:
        db_session.add(Plant(slug="test-carrot", common_name="Carrot", botanical_name="Daucus carota"))
        db_session.commit()
        path = _fixture(
            tmp_path,
            [
                {
                    "name": "Bed A",
                    "border_geometry": _rect(0, 0, 100, 100),
                    "plantings": [{"plant_slug": "test-carrot", "x_cm": 50, "y_cm": 50}],
                }
            ],
        )
        result = seed_example_garden(db_session, path)
        assert result.beds_imported == 1
        assert result.beds_failed == 0
        assert db_session.exec(select(Garden)).one() is not None
