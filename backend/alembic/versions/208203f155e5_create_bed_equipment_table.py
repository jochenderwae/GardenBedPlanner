"""create bed_equipment table

Revision ID: 208203f155e5
Revises: 7e572c798e71
Create Date: 2026-07-19 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '208203f155e5'
down_revision: Union[str, Sequence[str], None] = '7e572c798e71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "bed_equipment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bed_id", sa.Integer(), sa.ForeignKey("bed.id"), nullable=True),
        sa.Column("equipment_type", sa.String(), nullable=False),
        sa.Column("geometry", JSONB(), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column("water_delivery_lph", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("bed_equipment")
