"""create plant tables

Revision ID: 3badb93e90d7
Revises: 8ece1e150dae
Create Date: 2026-07-17 21:48:14.919341

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3badb93e90d7'
down_revision: Union[str, Sequence[str], None] = '8ece1e150dae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


sun_level_enum = sa.Enum("full_sun", "half_sun", "shadow", name="sunlevel")
period_type_enum = sa.Enum(
    "sowing", "planting", "fertilizing", "harvesting", name="periodtype"
)
companion_relationship_enum = sa.Enum("good", "bad", name="companionrelationship")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "plant",
        sa.Column("slug", sa.String(), primary_key=True),
        sa.Column("common_name", sa.String(), nullable=False),
        sa.Column("botanical_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("sowing_method", sa.String(), nullable=True),
        sa.Column("spread_cm", sa.Float(), nullable=True),
        sa.Column("row_spacing_cm", sa.Float(), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column("sun_level", sun_level_enum, nullable=True),
        sa.Column("soil_type", sa.String(), nullable=True),
        sa.Column("composting_needs", sa.String(), nullable=True),
        sa.Column("fertilizer_needs", sa.String(), nullable=True),
        sa.Column("needs_wind_cover", sa.Boolean(), nullable=True),
        sa.Column("needs_rain_cover", sa.Boolean(), nullable=True),
        sa.Column("water_needs", sa.String(), nullable=True),
    )

    op.create_table(
        "plant_data_source",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False
        ),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("attribution", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_plant_data_source_plant_slug", "plant_data_source", ["plant_slug"]
    )

    op.create_table(
        "seed_info",
        sa.Column(
            "plant_slug",
            sa.String(),
            sa.ForeignKey("plant.slug"),
            primary_key=True,
        ),
        sa.Column("seeds_per_gram", sa.Float(), nullable=True),
        sa.Column("pretreatment", sa.String(), nullable=True),
        sa.Column("produces_viable_seeds", sa.Boolean(), nullable=True),
        sa.Column("is_f1_hybrid", sa.Boolean(), nullable=True),
    )

    op.create_table(
        "plant_period",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False
        ),
        sa.Column("period_type", period_type_enum, nullable=False),
        sa.Column("start_month", sa.Integer(), nullable=False),
        sa.Column("end_month", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "start_month BETWEEN 1 AND 12", name="ck_plant_period_start_month"
        ),
        sa.CheckConstraint(
            "end_month BETWEEN 1 AND 12", name="ck_plant_period_end_month"
        ),
    )
    op.create_index("ix_plant_period_plant_slug", "plant_period", ["plant_slug"])

    op.create_table(
        "plant_companion",
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), primary_key=True
        ),
        sa.Column(
            "companion_plant_slug",
            sa.String(),
            sa.ForeignKey("plant.slug"),
            primary_key=True,
        ),
        sa.Column("relationship", companion_relationship_enum, nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.CheckConstraint(
            "plant_slug <> companion_plant_slug", name="ck_plant_companion_not_self"
        ),
    )

    op.create_table(
        "plant_bedding_need",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False
        ),
        sa.Column("need_type", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_plant_bedding_need_plant_slug", "plant_bedding_need", ["plant_slug"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("plant_bedding_need")
    op.drop_table("plant_companion")
    op.drop_table("plant_period")
    op.drop_table("seed_info")
    op.drop_table("plant_data_source")
    op.drop_table("plant")
