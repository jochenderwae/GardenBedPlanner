"""Regression coverage for #130 ("Alembic autogenerate is unreliable -
env.py only registers 2 of 10 model modules"). `backend/alembic/env.py`
builds its `target_metadata` from `SQLModel.metadata` after importing
`app.models` (the package) - not `app.main`, which pulls in every table
model only indirectly via its route imports and is what every other test
file's own `conftest.py`-driven `client` fixture relies on instead.

This runs the check in a genuinely fresh Python subprocess rather than
in-process - `SQLModel.metadata` is a process-global singleton, and
`conftest.py`'s own `from app.main import app` at collection time already
registers every table before any test body runs, so an in-process check
here would trivially pass regardless of whether `app.models`'s own
pkgutil-based auto-import mechanism actually works, providing no real
regression protection. A subprocess that imports *only* `app.models`
(mirroring exactly what `alembic/env.py` does) has no such contamination.

Deliberately does NOT touch a real database or Alembic's own autogenerate
machinery (that's already covered by an actual `alembic revision
--autogenerate` run against `garden_test`, done by hand during the tester
pass on #130) - this is the fast, DB-free regression guard for "did every
real model module actually get imported", which can run every time
without `TEST_DATABASE_URL`."""

import subprocess
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]

# One real table name per app/models/*.py file (excluding geometry.py,
# which is the shared Pydantic Geometry type, not a table module) - kept as
# a flat list here (deliberately not derived from app.models.* itself) so
# this test doesn't accidentally rely on the same registration mechanism
# it's trying to verify.
_EXPECTED_TABLE_NAMES = [
    "bed",
    "plant",
    "planting",
    "bed_equipment",
    "garden",
    "garden_plan",
    "action",
    "harvest_log",
    "push_subscription",
    "seed_inventory_item",
    "irrigation_zone",
]

_CHECK_SCRIPT = (
    "import app.models\n"
    "from sqlmodel import SQLModel\n"
    "print(','.join(sorted(t.name for t in SQLModel.metadata.sorted_tables)))\n"
)


def test_importing_app_models_alone_registers_every_table_on_sqlmodel_metadata() -> None:
    result = subprocess.run(
        [sys.executable, "-c", _CHECK_SCRIPT],
        cwd=_BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, f"subprocess importing app.models failed: {result.stderr}"

    registered = set(result.stdout.strip().split(","))
    missing = [name for name in _EXPECTED_TABLE_NAMES if name not in registered]
    assert not missing, (
        f"importing app.models alone (the same import alembic/env.py uses for its own "
        f"target_metadata) never registered these tables: {missing} - see #130"
    )
