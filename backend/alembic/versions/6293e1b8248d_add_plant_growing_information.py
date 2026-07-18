"""add plant growing information

Revision ID: 6293e1b8248d
Revises: 0b5e82fb2a1c
Create Date: 2026-07-18 08:40:37.382350

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6293e1b8248d'
down_revision: Union[str, Sequence[str], None] = '0b5e82fb2a1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


growing_info_record_type_enum = sa.Enum(
    "raw", "consolidated", name="growinginforecordtype"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "plant_growing_information",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False
        ),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("attribution", sa.String(), nullable=True),
        sa.Column("copyright_status", sa.String(), nullable=True),
        sa.Column(
            "record_type",
            growing_info_record_type_enum,
            nullable=False,
            server_default="raw",
        ),
        sa.Column("generic_for_species", sa.Boolean(), nullable=True),
    )
    op.create_index(
        "ix_plant_growing_information_plant_slug",
        "plant_growing_information",
        ["plant_slug"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("plant_growing_information")
