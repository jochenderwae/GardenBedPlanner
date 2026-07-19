---
name: db-query
description: Run a .sql file against garden-planner-dev's real Postgres. Use when asked to check/query/inspect the real database, or to verify a migration's raw SQL before trusting it.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql.ps1 *)
---

Write the query to a `.sql` file in the scratchpad directory, then run:

`C:\projects\GardenBedPlanner\.claude\skills\db-query\scripts\dev_psql.ps1 -File <path-to-.sql-file>`

(scp's the file over, runs it with `psql -f` against the real `garden` database, cleans up the remote temp copy.)

**This runs against the app's real deployed database by default** - the same credentials `infra/deploy/config.sh` provisions. If/when the remote-accessible *test* Postgres account exists, prefer that for anything exploratory or destructive (even inside a transaction) - reserve direct queries against the real `garden` database for genuine read-only verification.

For anything that writes or could be destructive: wrap it in `BEGIN; ... ROLLBACK;` first and inspect the output before ever considering a real `COMMIT` - this is exactly the pattern used to verify the family/genus taxonomy migration's raw SQL before trusting it (see git history / root `CLAUDE.md` if that precedent is useful context). Never write a bare destructive statement (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE` without a `WHERE`) directly - always transaction-wrapped, always reviewed before any real commit.

Read-only checks (row counts, spot-checking data before/after a migration) don't need the transaction wrapper - a plain `SELECT` is safe as-is.
