---
name: build-backend
description: Lint (ruff) the backend and smoke-check that the FastAPI app imports/constructs cleanly. Use whenever asked to build, verify, or check that the backend is sound.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\build-backend\scripts\backend_lint.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\build-backend\scripts\backend_check_imports.ps1)
---

Backend has no compiled build step (it's Python), so "build" here means: lint clean, and the app object actually constructs without error (catches broken imports, route-registration mistakes, bad Pydantic model definitions - the kind of thing that would otherwise only surface at server start).

Run, in order:

1. `C:\projects\GardenBedPlanner\.claude\skills\build-backend\scripts\backend_lint.ps1` (ruff)
2. `C:\projects\GardenBedPlanner\.claude\skills\build-backend\scripts\backend_check_imports.ps1` (imports `app.main:app`, prints the registered route count)

Always call by absolute path, never `cd` first - each script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report both results plainly. If either fails, show the actual error output.

**Every schema/model change needs its migration in the same commit** (root `CLAUDE.md` convention) - this skill doesn't check that for you, review it yourself. After any route/model change, also regenerate the frontend's typed client - see `/generate-api`.

This does not run tests - see `/test-backend` for that (pytest, already configured and working).
