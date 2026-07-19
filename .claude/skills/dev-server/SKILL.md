---
name: dev-server
description: Start or stop the local backend and/or frontend dev servers for iterative local work. Use when asked to start/stop/restart the dev server(s).
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\backend_dev_start.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\backend_dev_stop.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\frontend_dev_start.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\frontend_dev_stop.ps1)
---

Four scripts, called individually depending on what's actually being asked for - this skill doesn't always run all of them:

- `C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\backend_dev_start.ps1 [-Port 8000]` - detached `uvicorn`, logs to `backend/.uvicorn.{out,err}.log`, waits for `/api/health`
- `C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\backend_dev_stop.ps1` - stops it. **Call this on its own** (see the script's own `.NOTES`) - don't combine it in the same tool call with other text mentioning "uvicorn"/"app.main:app", which can make it match and kill its own host process.
- `C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\frontend_dev_start.ps1 [-Port 5173]` - detached `vite`, logs to `frontend/.vite.{out,err}.log`
- `C:\projects\GardenBedPlanner\.claude\skills\dev-server\scripts\frontend_dev_stop.ps1` - stops it. **Same self-match caveat as the backend stop script** - call it alone.

Always call by absolute path, never `cd` first - each script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Both servers need to be running simultaneously for the frontend to actually reach the API (vite proxies `/api` to `:8000` - see `vite.config.ts`) - if the task needs real end-to-end local behavior, start both, not just one.

Before starting either, check whether it's already running (`Get-NetTCPConnection -LocalPort 8000` / `-LocalPort 5173`) - a stale already-running instance from before a code change won't reflect that change (this has caused real confusion before, see root `CLAUDE.md`'s history) - prefer stop-then-start over trusting an existing process if there's any doubt.
