"""create planting table

Revision ID: 7e572c798e71
Revises: c28e1331dad1
Create Date: 2026-07-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '7e572c798e71'
down_revision: Union[str, Sequence[str], None] = 'c28e1331dad1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "planting",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bed_id", sa.Integer(), sa.ForeignKey("bed.id"), nullable=False),
        sa.Column("plant_slug", sa.String(), sa.ForeignKey("plant.slug"), nullable=False),
        sa.Column(
            "placement_type",
            sa.Enum("individual", "row", "field", name="placementtype"),
            nullable=False,
            server_default="individual",
        ),
        sa.Column("geometry", JSONB(), nullable=False),
        sa.Column("planted_date", sa.Date(), nullable=True),
        sa.Column("removed_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("planting")
    sa.Enum(name="placementtype").drop(op.get_bind(), checkfirst=True)
