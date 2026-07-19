---
name: test-backend
description: Run the backend's pytest suite. Use whenever asked to test, verify, or check the backend's tests pass.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1` (`uv run pytest` from `backend/`).

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report the result plainly (pass count, and full output for any failure - don't summarize away a real failure).

**Current coverage is thin** (one health-check test as of this skill's creation) - most of what this session built (Bed/Garden/Planting/BedEquipment CRUD) has no test coverage yet, only manual verification (lint + `/build-backend`'s import smoke-check + OpenAPI schema introspection, since there's no local Postgres to run real DB-backed tests against on this machine). See `docs/testing-plan.md` (Phase 1, Backend section) for the concrete plan: a `TEST_DATABASE_URL`-driven `conftest.py` (truncate-between-tests isolation, migrations applied once per session via Alembic's Python API), and the first tests to add (Bed/Garden/Planting/BedEquipment CRUD, `commit_or_409` → 409 behavior). Once `integration`-marked tests exist, they should `pytest.skip(...)` explicitly when `TEST_DATABASE_URL` is unset - report that skip reason plainly, not as a pass.

If a test needs a real Postgres and none is reachable locally, say so explicitly rather than skipping silently or reporting false success.
