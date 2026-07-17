"""create bed table

Revision ID: 8ece1e150dae
Revises: 
Create Date: 2026-07-16 22:02:44.240056

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8ece1e150dae'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


bed_type_enum = sa.Enum(
    "large_planter",
    "small_planter",
    "berry_row",
    "compost_bin",
    "fruit_tree",
    name="bedtype",
)


def upgrade() -> None:
    """Upgrade schema."""
    bed_type_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "bed",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("bed_type", bed_type_enum, nullable=False),
        sa.Column("width_cm", sa.Float(), nullable=False),
        sa.Column("length_cm", sa.Float(), nullable=False),
        sa.Column("height_cm", sa.Float(), nullable=False),
        sa.Column("has_greenhouse", sa.Boolean(), nullable=False),
        sa.Column("pos_x", sa.Float(), nullable=False),
        sa.Column("pos_y", sa.Float(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("bed")
    bed_type_enum.drop(op.get_bind(), checkfirst=True)
