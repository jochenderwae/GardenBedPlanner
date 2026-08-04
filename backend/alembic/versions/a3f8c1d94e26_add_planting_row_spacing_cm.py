"""add planting row_spacing_cm

Revision ID: a3f8c1d94e26
Revises: f7b2d4a6c803
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f8c1d94e26'
down_revision: Union[str, Sequence[str], None] = 'f7b2d4a6c803'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "planting",
        sa.Column("row_spacing_cm", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("planting", "row_spacing_cm")
