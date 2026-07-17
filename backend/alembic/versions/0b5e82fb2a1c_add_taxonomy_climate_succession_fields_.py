"""add taxonomy climate succession fields and pest interactions

Revision ID: 0b5e82fb2a1c
Revises: 3badb93e90d7
Create Date: 2026-07-17 22:45:00.839298

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b5e82fb2a1c'
down_revision: Union[str, Sequence[str], None] = '3badb93e90d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


pest_interaction_type_enum = sa.Enum(
    "attracts", "repels", "vulnerable_to", name="pestinteractiontype"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("plant", sa.Column("family", sa.String(), nullable=True))
    op.add_column("plant", sa.Column("genus", sa.String(), nullable=True))
    op.add_column(
        "plant", sa.Column("min_temperature_c", sa.Float(), nullable=True)
    )
    op.add_column(
        "plant", sa.Column("max_temperature_c", sa.Float(), nullable=True)
    )
    op.add_column(
        "plant", sa.Column("days_to_maturity", sa.Integer(), nullable=True)
    )
    op.add_column("plant", sa.Column("soil_ph_min", sa.Float(), nullable=True))
    op.add_column("plant", sa.Column("soil_ph_max", sa.Float(), nullable=True))
    op.add_column("plant", sa.Column("is_toxic", sa.Boolean(), nullable=True))
    op.add_column(
        "plant", sa.Column("toxicity_notes", sa.String(), nullable=True)
    )
    op.add_column("plant", sa.Column("is_edible", sa.Boolean(), nullable=True))
    op.add_column(
        "plant",
        sa.Column("edible_parts", sa.ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        "plant", sa.Column("succession_enabled", sa.Boolean(), nullable=True)
    )
    op.add_column(
        "plant",
        sa.Column("succession_interval_days", sa.Integer(), nullable=True),
    )
    op.add_column(
        "plant",
        sa.Column("succession_max_sowings", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_plant_soil_ph_min", "plant", "soil_ph_min BETWEEN 0 AND 14"
    )
    op.create_check_constraint(
        "ck_plant_soil_ph_max", "plant", "soil_ph_max BETWEEN 0 AND 14"
    )

    op.add_column(
        "plant_companion", sa.Column("mechanism", sa.String(), nullable=True)
    )

    op.create_table(
        "plant_pest_interaction",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False
        ),
        sa.Column("interaction_type", pest_interaction_type_enum, nullable=False),
        sa.Column("pest_or_insect", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_plant_pest_interaction_plant_slug",
        "plant_pest_interaction",
        ["plant_slug"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("plant_pest_interaction")

    op.drop_column("plant_companion", "mechanism")

    op.drop_constraint("ck_plant_soil_ph_max", "plant", type_="check")
    op.drop_constraint("ck_plant_soil_ph_min", "plant", type_="check")
    op.drop_column("plant", "succession_max_sowings")
    op.drop_column("plant", "succession_interval_days")
    op.drop_column("plant", "succession_enabled")
    op.drop_column("plant", "edible_parts")
    op.drop_column("plant", "is_edible")
    op.drop_column("plant", "toxicity_notes")
    op.drop_column("plant", "is_toxic")
    op.drop_column("plant", "soil_ph_max")
    op.drop_column("plant", "soil_ph_min")
    op.drop_column("plant", "days_to_maturity")
    op.drop_column("plant", "max_temperature_c")
    op.drop_column("plant", "min_temperature_c")
    op.drop_column("plant", "genus")
    op.drop_column("plant", "family")
