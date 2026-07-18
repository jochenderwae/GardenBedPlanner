"""normalize family genus tables

Revision ID: 07c142c9f474
Revises: 0c586808f5c2
Create Date: 2026-07-18 14:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '07c142c9f474'
down_revision: Union[str, Sequence[str], None] = '0c586808f5c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# plant.family/plant.genus were free-text strings (see
# 0b5e82fb2a1c_add_taxonomy_climate_succession_fields_). Replaced with real
# Family/Genus tables + FK columns, same "lookup table over enum/free-text"
# pattern 0c586808f5c2 already used for period_type - gives referential
# integrity for taxonomy names and somewhere to hang per-family/genus data
# later, instead of the same family name potentially being spelled several
# different ways across rows.
def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "family",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    op.create_index("ix_family_name", "family", ["name"], unique=True)

    op.create_table(
        "genus",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("family_id", sa.Integer(), sa.ForeignKey("family.id"), nullable=True),
    )
    op.create_index("ix_genus_name", "genus", ["name"], unique=True)

    # Backfill: one family row per distinct existing plant.family string...
    op.execute(
        "INSERT INTO family (name) "
        "SELECT DISTINCT family FROM plant WHERE family IS NOT NULL"
    )
    # ...one genus row per distinct plant.genus string, paired with whichever
    # family that genus happened to co-occur with (DISTINCT ON picks one
    # arbitrarily if a genus was inconsistently paired with >1 family string
    # in the source data - a data-quality issue for a cleanup pass, not
    # something this migration can resolve on its own).
    op.execute(
        "INSERT INTO genus (name, family_id) "
        "SELECT DISTINCT ON (p.genus) p.genus, f.id "
        "FROM plant p LEFT JOIN family f ON f.name = p.family "
        "WHERE p.genus IS NOT NULL "
        "ORDER BY p.genus, p.family"
    )

    op.add_column("plant", sa.Column("family_id", sa.Integer(), nullable=True))
    op.add_column("plant", sa.Column("genus_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_plant_family_id", "plant", "family", ["family_id"], ["id"])
    op.create_foreign_key("fk_plant_genus_id", "plant", "genus", ["genus_id"], ["id"])

    op.execute(
        "UPDATE plant SET family_id = f.id FROM family f WHERE plant.family = f.name"
    )
    op.execute(
        "UPDATE plant SET genus_id = g.id FROM genus g WHERE plant.genus = g.name"
    )

    op.drop_column("plant", "family")
    op.drop_column("plant", "genus")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("plant", sa.Column("family", sa.String(), nullable=True))
    op.add_column("plant", sa.Column("genus", sa.String(), nullable=True))
    op.execute(
        "UPDATE plant SET family = f.name FROM family f WHERE plant.family_id = f.id"
    )
    op.execute(
        "UPDATE plant SET genus = g.name FROM genus g WHERE plant.genus_id = g.id"
    )

    op.drop_constraint("fk_plant_genus_id", "plant", type_="foreignkey")
    op.drop_constraint("fk_plant_family_id", "plant", type_="foreignkey")
    op.drop_column("plant", "genus_id")
    op.drop_column("plant", "family_id")

    op.drop_index("ix_genus_name", table_name="genus")
    op.drop_table("genus")
    op.drop_index("ix_family_name", table_name="family")
    op.drop_table("family")
