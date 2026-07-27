"""add planting spacing_cm

Revision ID: 6b1e9f3a7c52
Revises: 2a4d7e91c3b6
Create Date: 2026-07-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b1e9f3a7c52'
down_revision: Union[str, Sequence[str], None] = '2a4d7e91c3b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "planting",
        sa.Column("spacing_cm", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("planting", "spacing_cm")
