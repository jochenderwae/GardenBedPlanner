"""Shared fixtures for backend integration tests (see docs/testing-plan.md
Phase 1 - "Backend"). Tests marked `@pytest.mark.integration` need a real
Postgres reachable via `TEST_DATABASE_URL` (garden_test on garden-planner-dev,
see backend/.env.example) - if it isn't set, those tests skip explicitly
(never silently pass) via the `_test_database_url` fixture below.

Isolation strategy: truncate every app table after each test, rather than
transaction-per-test rollback - the app's own route handlers call
`session.commit()` directly (`app/api/deps.py`'s `commit_or_409`), which a
rollback-based strategy would have to fight around. Truncate is slower but
trivial and works transparently with that.
"""

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, SQLModel

_BACKEND_DIR = Path(__file__).resolve().parents[1]

# Same lookup order as .claude/skills/db-query/scripts/dev_psql_test.ps1:
# checks the environment first, then falls back to backend/.env.
_TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or dotenv_values(_BACKEND_DIR / ".env").get(
    "TEST_DATABASE_URL"
)

if _TEST_DATABASE_URL:
    # Must happen before anything imports app.core.config (which builds its
    # module-level `settings` singleton, and app.core.db's `engine`, from
    # DATABASE_URL at import time) - points the real app dependency-injected
    # session at garden_test instead of the real `garden` database, so
    # integration tests exercise the actual get_session()/commit_or_409()
    # path, not a parallel test-only engine.
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.core.db import engine, get_session  # noqa: E402
from app.main import app  # noqa: E402

# Importing app.main pulls in every route module, which pulls in every
# SQLModel table model - SQLModel.metadata now knows about all of them.
_ALL_TABLE_NAMES = [t.name for t in SQLModel.metadata.sorted_tables]


@pytest.fixture(scope="session")
def _migrated_db() -> None:
    """Applies every Alembic migration once per test session, via Alembic's
    Python API (not shelled out) - skips with an explicit message if
    TEST_DATABASE_URL isn't configured, rather than quietly no-op-ing."""
    if not _TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set - skipping integration tests (see backend/.env.example)")
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    command.upgrade(cfg, "head")


@pytest.fixture()
def db_session(_migrated_db: None) -> Generator[Session, None, None]:
    """One Session per test, shared by every TestClient request the test
    makes (via the `client` fixture's dependency override below) - so a test
    can create something through the API and immediately query it back in
    the same session. Truncates every app table on teardown."""
    with Session(engine) as session:
        yield session
    with engine.begin() as conn:
        quoted = ", ".join(f'"{name}"' for name in _ALL_TABLE_NAMES)
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def _get_session_override() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_session] = _get_session_override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def rectangle(x: float = 0, y: float = 0, width: float = 100, height: float = 100, rotation: float = 0) -> dict:
    """A minimal valid Geometry payload (see app/models/geometry.py) - shared
    by every CRUD test that needs a border_geometry/geometry value and
    doesn't care about its specifics."""
    return {"type": "rectangle", "x": x, "y": y, "width": width, "height": height, "rotation": rotation}
