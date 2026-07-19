---
name: db-query
description: Run a .sql file against garden-planner-dev's real Postgres, either the test database (garden_test, direct connection) or the app's real database (garden, via SSH). Use when asked to check/query/inspect the database, verify test data, or verify a migration's raw SQL before trusting it.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql.ps1 *) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql_test.ps1 *)
---

Two scripts, pick based on which database the task actually needs:

## `garden_test` (test database) - direct connection, prefer this by default

`C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql_test.ps1 -File <path-to-.sql-file>`

Connects straight from this laptop to `garden-planner-dev`'s Postgres over the LAN (`pg_hba.conf` was opened for this - see `docs/testing-plan.md`) via `psycopg`, no SSH/scp hop. Needs `TEST_DATABASE_URL` set - it checks the environment first, then falls back to `backend/.env` (see `backend/.env.example`). `garden_test` is a separate, disposable database, independent of the real deployed app database - **freely `CREATE`/`DROP`/`TRUNCATE`, no transaction-wrapping needed**, that's the whole point of it existing.

## `garden` (the real app database) - SSH, more caution

`C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql.ps1 -File <path-to-.sql-file>`

Write the query to a `.sql` file in the scratchpad directory first, then run the above (scp's the file over, runs it with `psql -f` against the real `garden` database via SSH, cleans up the remote temp copy). This is the app's real deployed data - the same credentials `infra/deploy/config.sh` provisions.

**For anything that writes or could be destructive against `garden`**: wrap it in `BEGIN; ... ROLLBACK;` first and inspect the output before ever considering a real `COMMIT` - this is exactly the pattern used to verify the family/genus taxonomy migration's raw SQL before trusting it (see git history / root `CLAUDE.md` if that precedent is useful context). Never write a bare destructive statement (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE` without a `WHERE`) directly - always transaction-wrapped, always reviewed before any real commit. Read-only checks (row counts, spot-checking data before/after a migration) don't need the transaction wrapper - a plain `SELECT` is safe as-is.

**Prefer `garden_test` over `garden` whenever the task is exploratory, destructive, or test-related** - only reach for `garden`/`dev_psql.ps1` for genuine verification against real production-adjacent data.
