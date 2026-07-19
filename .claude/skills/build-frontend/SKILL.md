---
name: build-frontend
description: Lint (oxlint) and build (tsc typecheck + vite build) the frontend. Use whenever asked to build, typecheck, verify, or check that the frontend compiles.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\build-frontend\scripts\frontend_lint.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\build-frontend\scripts\frontend_build.ps1)
---

Run, in order:

1. `C:\projects\GardenBedPlanner\.claude\skills\build-frontend\scripts\frontend_lint.ps1` (oxlint)
2. `C:\projects\GardenBedPlanner\.claude\skills\build-frontend\scripts\frontend_build.ps1` (`tsc -b && vite build`)

Always call by absolute path, never `cd` first - each script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report both results plainly. If either fails, stop and show the actual error output - don't guess at a fix without it. A build failure after backend route/model changes is often a stale typed client: check whether `frontend/src/api/schema.d.ts` needs regenerating - see `/generate-api` (not part of this skill, since it needs the backend running on `:8000` first).

This does not run tests - see `/test-frontend` for that (currently a stub, no test framework configured yet).
