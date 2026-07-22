---
name: test-backend
description: Run the backend's pytest suite. Use whenever asked to test, verify, or check the backend's tests pass.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\test-backend\scripts\backend_test.ps1` (`uv run pytest` from `backend/`).

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report the result plainly (pass count, and full output for any failure - don't summarize away a real failure).

**Update (2026-07-21): real coverage now exists** - `backend/tests/` has grown well past the original single health-check test (CRUD suites for Bed/Garden/Planting/BedEquipment/GardenPlan/Action/HarvestLog/SeedInventoryItem, plus rotation, placement-check, push-subscription, reminder, and plant-parent-slug tests). This note is stale the moment a new test file lands and nobody updates it here - don't trust the specific list above as current; run the suite and read `backend/tests/` directly if you need the real state. Still worth extending per `docs/testing-plan.md` (Phase 1/2/3, Backend section) wherever a route/model lacks coverage - the `tester` agent (`.claude/agents/tester.md`) owns actively closing these gaps per-ticket now, not just this skill's original scaffolding plan.

**`TEST_DATABASE_URL` is now real and reachable** - a dedicated `garden_test` database on `garden-planner-dev`'s Postgres, connectable directly from this laptop (no SSH needed, `pg_hba.conf` was opened for it), value in `backend/.env` (see `.env.example`). Once `integration`-marked tests exist per the plan above, they should still `pytest.skip(...)` explicitly if `TEST_DATABASE_URL` happens to be unset in whatever environment is running them - report that skip reason plainly, not as a pass - but don't assume it's unreachable without checking; it should normally be there now.
