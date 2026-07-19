---
name: migrate-backend
description: Apply pending Alembic migrations (alembic upgrade head) against whatever DATABASE_URL is currently configured. Use when asked to run/apply migrations, distinct from a full backend deploy.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\migrate-backend\scripts\backend_migrate.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\migrate-backend\scripts\backend_migrate.ps1` (`uv run alembic upgrade head` from `backend/`).

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

**Needs a reachable `DATABASE_URL`** (`backend/.env`, see `.env.example`). There is no local Postgres on this Windows checkout - this only works when `DATABASE_URL` points at a real instance: `garden-planner-dev`'s real Postgres (same one `/deploy-backend` migrates automatically as part of a full deploy), or - once available - the remote-accessible test Postgres account, via a `TEST_DATABASE_URL`/local `.env` override.

**Before running this against a database with real rows** (not a brand-new empty table), confirm the actual row count first via `/db-query` rather than assuming from memory - see root `CLAUDE.md`'s note on why this matters (a migration correct against an empty table can still be wrong against real data).

This is distinct from `/deploy-backend`, which also does this as one step of a full redeploy (git pull, `uv sync`, migrate, restart) - use this skill when you specifically want to apply migrations without a full redeploy, e.g. against the new test Postgres account for local iteration.
