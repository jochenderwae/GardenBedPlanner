---
name: test-backend
description: Run the backend's pytest suite. Use whenever asked to test, verify, or check the backend's tests pass.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1` (`uv run pytest` from `backend/`).

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report the result plainly (pass count, and full output for any failure - don't summarize away a real failure).

**Current coverage is thin** (one health-check test as of this skill's creation) - most of what this session built (Bed/Garden/Planting/BedEquipment CRUD) has no test coverage yet, only manual verification (lint + `/build-backend`'s import smoke-check + OpenAPI schema introspection). See `docs/testing-plan.md` (Phase 1, Backend section) for the concrete plan: a `TEST_DATABASE_URL`-driven `conftest.py` (truncate-between-tests isolation, migrations applied once per session via Alembic's Python API), and the first tests to add (Bed/Garden/Planting/BedEquipment CRUD, `commit_or_409` → 409 behavior).

**`TEST_DATABASE_URL` is now real and reachable** - a dedicated `garden_test` database on `garden-planner-dev`'s Postgres, connectable directly from this laptop (no SSH needed, `pg_hba.conf` was opened for it), value in `backend/.env` (see `.env.example`). Once `integration`-marked tests exist per the plan above, they should still `pytest.skip(...)` explicitly if `TEST_DATABASE_URL` happens to be unset in whatever environment is running them - report that skip reason plainly, not as a pass - but don't assume it's unreachable without checking; it should normally be there now.
