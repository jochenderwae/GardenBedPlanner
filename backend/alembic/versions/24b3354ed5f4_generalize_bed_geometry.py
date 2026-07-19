"""generalize bed geometry

Revision ID: 24b3354ed5f4
Revises: 07c142c9f474
Create Date: 2026-07-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '24b3354ed5f4'
down_revision: Union[str, Sequence[str], None] = '07c142c9f474'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# bed.bed_type was a closed 5-value enum (large_planter|small_planter|
# berry_row|compost_bin|fruit_tree) - real usage showed these were only
# ever meant as examples of what a planter could be, not an exhaustive
# category list. Replaced with free-text category. Flat width_cm/length_cm/
# pos_x/pos_y replaced with jsonb border_geometry (rectangle|polygon, with
# rotation) per docs/schema.md's original "Geometry format" design - the
# implemented flat-field Bed was a simplification of that sketch, not the
# other way around. See app/models/geometry.py.
_old_bed_type_enum = sa.Enum(
    "large_planter", "small_planter", "berry_row", "compost_bin", "fruit_tree",
    name="bedtype",
)
# Reuses the existing "sunlevel" Postgres enum type created by
# 3badb93e90d7_create_plant_tables.py for Plant.sun_level - create_type=False
# so this migration doesn't try to create a second "sunlevel" type.
_sun_level_enum = sa.Enum(
    "full_sun", "half_sun", "shadow", name="sunlevel", create_type=False,
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("bed", sa.Column("category", sa.String(), nullable=True))
    op.add_column("bed", sa.Column("orientation", sa.String(), nullable=True))
    op.add_column("bed", sa.Column("is_raised", sa.Boolean(), nullable=True))
    op.add_column("bed", sa.Column("soil_type", sa.String(), nullable=True))
    op.add_column("bed", sa.Column("sun_level", _sun_level_enum, nullable=True))
    # Nullable for now - backfilled below, then locked to NOT NULL once every
    # row has a value. Doing it in two steps (not NOT NULL from the start)
    # so this migration works whether the table is empty or has real rows -
    # verify the actual row count on garden-planner-dev before running this
    # for real rather than assuming empty; a non-empty table still gets a
    # correct migration either way via the backfill below, not a blind drop.
    op.add_column("bed", sa.Column("border_geometry", JSONB(), nullable=True))

    op.execute(
        "UPDATE bed SET border_geometry = jsonb_build_object("
        "'type', 'rectangle', 'x', pos_x, 'y', pos_y, "
        "'width', width_cm, 'height', length_cm, 'rotation', 0)"
    )
    op.execute(
        "UPDATE bed SET category = bed_type::text WHERE category IS NULL"
    )

    op.alter_column("bed", "border_geometry", nullable=False)

    op.drop_column("bed", "bed_type")
    op.drop_column("bed", "width_cm")
    op.drop_column("bed", "length_cm")
    op.drop_column("bed", "pos_x")
    op.drop_column("bed", "pos_y")
    _old_bed_type_enum.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema. Lossy for polygon rows (approximated via bounding
    box) and for category values that don't match one of the 5 original
    enum labels (falls back to 'large_planter') - there's no way to recover
    information this migration's upgrade() path discarded."""
    _old_bed_type_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "bed", sa.Column("bed_type", _old_bed_type_enum, nullable=True)
    )
    op.add_column("bed", sa.Column("width_cm", sa.Float(), nullable=True))
    op.add_column("bed", sa.Column("length_cm", sa.Float(), nullable=True))
    op.add_column("bed", sa.Column("pos_x", sa.Float(), nullable=True))
    op.add_column("bed", sa.Column("pos_y", sa.Float(), nullable=True))

    op.execute(
        "UPDATE bed SET "
        "pos_x = COALESCE((border_geometry->>'x')::float, "
        "  (SELECT MIN((pt->>'x')::float) FROM jsonb_array_elements(border_geometry->'points') pt)), "
        "pos_y = COALESCE((border_geometry->>'y')::float, "
        "  (SELECT MIN((pt->>'y')::float) FROM jsonb_array_elements(border_geometry->'points') pt)), "
        "width_cm = COALESCE((border_geometry->>'width')::float, "
        "  (SELECT MAX((pt->>'x')::float) - MIN((pt->>'x')::float) FROM jsonb_array_elements(border_geometry->'points') pt)), "
        "length_cm = COALESCE((border_geometry->>'height')::float, "
        "  (SELECT MAX((pt->>'y')::float) - MIN((pt->>'y')::float) FROM jsonb_array_elements(border_geometry->'points') pt))"
    )
    op.execute(
        "UPDATE bed SET bed_type = CASE WHEN category IN "
        "('large_planter','small_planter','berry_row','compost_bin','fruit_tree') "
        "THEN category::bedtype ELSE 'large_planter'::bedtype END"
    )

    op.alter_column("bed", "bed_type", nullable=False)
    op.alter_column("bed", "width_cm", nullable=False)
    op.alter_column("bed", "length_cm", nullable=False)
    op.alter_column("bed", "pos_x", nullable=False)
    op.alter_column("bed", "pos_y", nullable=False)

    op.drop_column("bed", "border_geometry")
    op.drop_column("bed", "sun_level")
    op.drop_column("bed", "soil_type")
    op.drop_column("bed", "is_raised")
    op.drop_column("bed", "orientation")
    op.drop_column("bed", "category")
