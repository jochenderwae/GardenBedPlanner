"""drop bed orientation

Revision ID: 9d1c6f2a4e0b
Revises: 5a3939105b70
Create Date: 2026-07-20 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d1c6f2a4e0b'
down_revision: Union[str, Sequence[str], None] = '5a3939105b70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("bed", "orientation")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("bed", sa.Column("orientation", sa.String(), nullable=True))
