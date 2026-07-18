"""add plant life cycle

Revision ID: cd2f3a9b9ded
Revises: 6293e1b8248d
Create Date: 2026-07-18 15:34:13.441397

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cd2f3a9b9ded'
down_revision: Union[str, Sequence[str], None] = '6293e1b8248d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Adding a column to an EXISTING table (op.add_column), unlike the earlier
# create_table cases in this project - create_table/drop_table manage an
# enum type's lifecycle automatically, but add_column/drop_column don't, so
# the type has to be created/dropped explicitly here. Not the same bug as
# the create_bed_table duplicate-CREATE-TYPE issue (see docs/schema.md):
# there's only one creator here, no double-creation risk.
life_cycle_enum = sa.Enum("annual", "biennial", "perennial", name="lifecycle")


def upgrade() -> None:
    """Upgrade schema."""
    life_cycle_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "plant",
        sa.Column("life_cycle", life_cycle_enum, nullable=True),
    )
    op.add_column(
        "plant",
        sa.Column("life_cycle_years", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("plant", "life_cycle_years")
    op.drop_column("plant", "life_cycle")
    life_cycle_enum.drop(op.get_bind(), checkfirst=True)
