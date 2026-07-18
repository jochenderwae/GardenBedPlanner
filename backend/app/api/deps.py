from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session


def commit_or_409(session: Session) -> None:
    """Shared by every route module: a constraint violation (FK, unique,
    check) should come back as a 409 the client can act on, not a bare 500
    with a stack trace."""
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(exc.orig)) from exc
