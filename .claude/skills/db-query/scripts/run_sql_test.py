"""Runs a .sql file against TEST_DATABASE_URL (the garden_test database on
garden-planner-dev) via psycopg. Called by dev_psql_test.ps1 - not meant to
be run directly outside that wrapper, though it works standalone too.
"""

import os
import sys

import psycopg
from dotenv import dotenv_values


def _resolve_dsn() -> str:
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "backend", ".env")
        dsn = dotenv_values(env_path).get("TEST_DATABASE_URL")
    if not dsn:
        print(
            "TEST_DATABASE_URL is not set (checked the environment and backend/.env). "
            "See backend/.env.example.",
            file=sys.stderr,
        )
        sys.exit(1)
    # SQLAlchemy/SQLModel-style URLs use "postgresql+psycopg://" (the driver
    # suffix tells SQLAlchemy which DBAPI to load) - psycopg.connect() wants
    # a plain "postgresql://" DSN and doesn't understand the "+psycopg" part.
    return dsn.replace("postgresql+psycopg://", "postgresql://", 1)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: run_sql_test.py <path-to-.sql-file>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        sql = f.read()

    with psycopg.connect(_resolve_dsn(), autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(sql)
        if cur.description:
            print("\t".join(d.name for d in cur.description))
            for row in cur.fetchall():
                print("\t".join(str(v) for v in row))


if __name__ == "__main__":
    main()
