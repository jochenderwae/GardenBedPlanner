"""convert period type to lookup table

Revision ID: 0c586808f5c2
Revises: cd2f3a9b9ded
Create Date: 2026-07-18 15:40:59.345636

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0c586808f5c2'
down_revision: Union[str, Sequence[str], None] = 'cd2f3a9b9ded'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# plant_period.period_type was a fixed 4-value Postgres enum (see
# create_plant_tables). Replaced with a lookup table so new period types
# (e.g. pruning, thinning, mulching - not foreseeable up front) can be
# added later as a data insert, not a schema migration.
_period_type_table = sa.table(
    "period_type",
    sa.column("code", sa.String()),
    sa.column("description", sa.String()),
)
_SEED_ROWS = [
    {"code": "sowing", "description": "Seed sowing window"},
    {"code": "planting", "description": "Transplanting/planting-out window"},
    {"code": "fertilizing", "description": "Fertilizing window"},
    {"code": "harvesting", "description": "Harvesting window"},
]
_old_period_type_enum = sa.Enum(
    "sowing", "planting", "fertilizing", "harvesting", name="periodtype"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "period_type",
        sa.Column("code", sa.String(), primary_key=True),
        sa.Column("description", sa.String(), nullable=True),
    )
    op.bulk_insert(_period_type_table, _SEED_ROWS)

    op.alter_column(
        "plant_period",
        "period_type",
        type_=sa.String(),
        postgresql_using="period_type::text",
    )
    op.create_foreign_key(
        "fk_plant_period_period_type",
        "plant_period",
        "period_type",
        ["period_type"],
        ["code"],
    )
    _old_period_type_enum.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema."""
    _old_period_type_enum.create(op.get_bind(), checkfirst=True)
    op.drop_constraint(
        "fk_plant_period_period_type", "plant_period", type_="foreignkey"
    )
    op.alter_column(
        "plant_period",
        "period_type",
        type_=_old_period_type_enum,
        postgresql_using="period_type::periodtype",
    )
    op.drop_table("period_type")
