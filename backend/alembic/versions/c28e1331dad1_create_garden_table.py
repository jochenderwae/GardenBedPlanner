"""create garden table

Revision ID: c28e1331dad1
Revises: 24b3354ed5f4
Create Date: 2026-07-19 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'c28e1331dad1'
down_revision: Union[str, Sequence[str], None] = '24b3354ed5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "garden",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("border_geometry", JSONB(), nullable=False),
        sa.Column("climate_zone", sa.String(), nullable=True),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("garden")
