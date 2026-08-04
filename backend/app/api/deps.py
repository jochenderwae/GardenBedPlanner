from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select


def commit_or_409(session: Session) -> None:
    """Shared by every route module: a constraint violation (FK, unique,
    check) should come back as a 409 the client can act on, not a bare 500
    with a stack trace."""
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(exc.orig)) from exc


def get_active_garden(session: Session):
    """#238: the garden every garden-scoped create route (Bed, GardenPlan)
    resolves `garden_id` against server-side when the client doesn't supply
    one explicitly - never trust a client-supplied garden_id per call site.
    Falls back to the first Garden row if none is flagged `is_active`
    (shouldn't happen post-migration, but defensive rather than a 500 if it
    ever does), and returns None (not a 404) when no Garden exists at all -
    plenty of existing flows (most test fixtures, app/scripts/
    import_example_garden.py before its own Garden get-or-create runs)
    create a Bed/GardenPlan before any Garden exists, and that must keep
    working exactly as it did before garden_id existed, just with a null
    garden_id rather than an error."""
    from app.models.garden import Garden

    active = session.exec(select(Garden).where(Garden.is_active == True)).first()  # noqa: E712
    if active is not None:
        return active
    return session.exec(select(Garden)).first()
