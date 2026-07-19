---
name: generate-api
description: Regenerate the frontend's typed API client (frontend/src/api/schema.d.ts) from the backend's live OpenAPI schema. Use after any backend route/model change, or when asked to sync/regenerate the frontend API types.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\generate-api\scripts\frontend_generate_api.ps1)
---

**Needs the backend running and reachable on `:8000` first** - this script fetches the live OpenAPI schema from `http://localhost:8000/openapi.json`.

1. Check whether a backend dev server is already up (`Get-NetTCPConnection -LocalPort 8000`, or just try the request). If not, start one via `/dev-server`.
2. Run `C:\projects\GardenBedPlanner\.claude\skills\generate-api\scripts\frontend_generate_api.ps1`.
3. If you started the backend just for this, consider whether to leave it running (useful if more frontend work follows) or stop it via `/dev-server` - your call based on what's next, not automatic either way.

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

**Watch for a stale server serving old code**: if the backend dev server was already running from *before* the schema-changing edit, its in-memory app won't reflect the new routes/models. Prefer starting a fresh one (`/dev-server` stop then start) rather than trusting an already-running process, unless you know it was started after the change.

Root `CLAUDE.md` convention: regenerate this after *every* backend schema/route change, in the same unit of work as the change itself - don't let it drift.
