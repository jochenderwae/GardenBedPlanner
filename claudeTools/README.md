# claudeTools

PowerShell wrapper scripts for commands Claude runs often in this repo. The point: a raw `cd <dir>; <command>` has a different literal signature every time depending on the directory it's chained from, so the permission system can never learn to trust it - these scripts have a fixed path and can be pre-approved once (see `.claude/settings.local.json`'s allowlist) instead of prompting on every call.

Run them from the repo root (`.\claudeTools\<script>.ps1 [args...]`) or by full path - each resolves its own working directory via `$PSScriptRoot`, so it doesn't matter where the caller's cwd currently is.

Windows PowerShell only (`.ps1`), not `.sh` - the `Bash` tool has no POSIX shell available in this environment ("No suitable shell found"); `PowerShell` is what actually works here. If you're extending this directory, keep new scripts `.ps1`.

## Scripts

**Frontend** (`frontend/`)
- `frontend_lint.ps1` — oxlint
- `frontend_build.ps1` — typecheck + production build
- `frontend_generate_api.ps1` — regenerate the typed API client from the backend's live OpenAPI schema (backend must already be reachable on `:8000` - run `backend_dev_start.ps1` first)

**Backend** (`backend/`)
- `backend_lint.ps1` — ruff
- `backend_test.ps1` — pytest
- `backend_migrate.ps1` — `alembic upgrade head` (needs a reachable `DATABASE_URL` - no local Postgres on this Windows checkout)
- `backend_dev_start.ps1 [-Port 8000]` — starts `uvicorn` detached (survives the tool call ending), logs to `backend/.uvicorn.{out,err}.log`, waits for `/api/health`
- `backend_dev_stop.ps1` — stops any dev-server `uvicorn` process it finds

**Data/ETL** (`data/`)
- `data_lint.ps1` — ruff over `data/etl/`
- `data_run_module.ps1 <module> [args...]` — `uv run python -m <module>` from `data/`, e.g. `data_run_module.ps1 etl.growing_info.run`, `data_run_module.ps1 etl.state_report`. One stable wrapper covers every `etl.*` entrypoint instead of a new script per module.
- `data_run_script.ps1 <path> [args...]` — runs an arbitrary/scratch Python script with `data/` on `PYTHONPATH` (so `from etl...` imports resolve) regardless of where the script file lives

**garden-planner-dev** (see `infra/deploy/CLAUDE.md`)
- `dev_ssh_deploy_backend.ps1` — redeploy just the backend (`03-deploy-backend.sh`)
- `dev_ssh_deploy_all.ps1` — redeploy backend + frontend (`deploy.sh`)
- `dev_ssh_health.ps1` — health endpoint + deployed commit/branch + service state
- `dev_psql.ps1 -File <path>` — scp a local `.sql` file over and run it with `psql -f` against the real `garden` database, then clean up the remote temp copy

## Adding a new script

A command deserves a wrapper here once it's been run more than once or twice with the same shape (even if arguments vary, like `data_run_module.ps1`) - a genuinely one-off command doesn't. Keep each script single-purpose and named `<area>_<verb>.ps1`; add it to the list above and to root `CLAUDE.md`'s Commands section in the same change, and pre-approve it in `.claude/settings.local.json` so it stops prompting.

## The data-engineer agent

`.claude/agents/data-engineer.md` documents the data/ETL scripts here as its preferred way to run things too, subject to its own working-directory restriction (it only *writes* inside `data/` - reading/executing a script in `claudeTools/` is fine, the scripts themselves only touch `data/` or SSH to `garden-planner-dev`).
