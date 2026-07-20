"""drop bed is_raised

Revision ID: 5a3939105b70
Revises: 77b41dd1b935
Create Date: 2026-07-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a3939105b70'
down_revision: Union[str, Sequence[str], None] = '77b41dd1b935'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("bed", "is_raised")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("bed", sa.Column("is_raised", sa.Boolean(), nullable=True))
