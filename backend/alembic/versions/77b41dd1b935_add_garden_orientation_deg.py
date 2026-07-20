"""add garden orientation_deg

Revision ID: 77b41dd1b935
Revises: 208203f155e5
Create Date: 2026-07-20 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '77b41dd1b935'
down_revision: Union[str, Sequence[str], None] = '208203f155e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "garden",
        sa.Column("orientation_deg", sa.Float(), nullable=False, server_default="0.0"),
    )
    # Drop the server_default once existing rows are backfilled - matches
    # the pattern of not carrying a default forward at the DB level once
    # the app layer (Garden.orientation_deg = 0.0) covers new-row inserts.
    op.alter_column("garden", "orientation_deg", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("garden", "orientation_deg")
