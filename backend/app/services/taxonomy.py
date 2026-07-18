"""Family/Genus find-or-create resolution - shared by the API layer
(app/api/routes/plants.py, resolving name strings typed/imported through the
API into FK ids) and the ETL importer (app/scripts/import_plants.py,
resolving the plain family/genus strings in data/plants/*.json the same way)
so the two don't duplicate or drift on this logic.
"""

from sqlmodel import Session, select

from app.models.plant import Family, Genus


def find_or_create_family(session: Session, name: str | None) -> int | None:
    if not name:
        return None
    existing = session.exec(select(Family).where(Family.name == name)).first()
    if existing:
        return existing.id
    family = Family(name=name)
    session.add(family)
    session.flush()
    return family.id


def find_or_create_genus(session: Session, name: str | None, family_id: int | None) -> int | None:
    """Doesn't update an existing genus's family_id if one's already on
    file - conflicting family/genus pairings across sources are a
    data-quality issue for a cleanup pass to reconcile, not something to
    silently overwrite mid-request."""
    if not name:
        return None
    existing = session.exec(select(Genus).where(Genus.name == name)).first()
    if existing:
        return existing.id
    genus = Genus(name=name, family_id=family_id)
    session.add(genus)
    session.flush()
    return genus.id
