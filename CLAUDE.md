# CLAUDE.md
 
This file gives Claude Code context on this project. Keep it under ~200 lines and keep instructions verifiable ("run X before committing", not "test thoroughly").
 
## Project overview
 
A self-hosted, open source home garden management application. Single user (no auth in v1). Manages:
 
- Physical garden layout: 4 large wooden planters (70×70×200cm, one with a greenhouse), 3 small planters (30×70×70cm), a berry row (raspberry, blueberry, redcurrant, gooseberry, sunflowers), 2× 1m³ compost bins, 2 fruit trees (sour cherry, pear).
- Bed/crop planning with succession planting (what can follow what once a crop is harvested).
- Drip irrigation zone planning.
- Composting and fertilization logging.
- Seed buying guide with an agenda/reminders view.
- Harvest logs (yield, quality, notes) to inform next year's planning.
- Weather/climate data import to adjust planting decisions for a changing climate in Belgium.

Bonus/later scope: see [`docs/wishlist.md`](docs/wishlist.md) — pick from it once core functionality above is done.
 
## Tech stack
 
**Backend**
- FastAPI (Python) — REST API, auto-generated OpenAPI schema
- PostgreSQL — primary datastore
- SQLModel (or SQLAlchemy + Pydantic) for models/schemas
- Alembic for migrations — set up before writing the first real model, never skip a migration for a schema change
- APScheduler (in-process) for scheduled jobs (reminder checks, weather pulls) — no Celery needed at this scale
- `pywebpush` for sending Web Push notifications (VAPID-based, no third-party push service)
**Frontend**
- React + TypeScript + Vite
- `react-konva` (Konva.js) for the WYSIWYG bed/layout editor — beds, rows, trellises, drip lines as draggable/resizable canvas objects
- Tailwind CSS + shadcn/ui for non-canvas UI (forms, agenda, dashboards)
- TanStack Query for API data fetching/caching
- Typed API client generated from the FastAPI OpenAPI schema via `openapi-typescript` (or `orval`) — regenerate whenever backend schemas change, don't hand-write fetch wrappers
- `vite-plugin-pwa` for PWA manifest + service worker (installable, offline caching, push notification support)
**Notifications**
- Native Web Push (Push API + Service Worker + VAPID), not a third-party service like ntfy
- iOS Safari requires the PWA to be installed via "Add to Home Screen" before push permission requests will work — an open Safari tab won't get prompted
- No auth/multi-device subscription management needed in v1 (single user) — can add later if sharing access becomes a goal
**Infrastructure**
- Proxmox, Debian 13 (trixie) LXC `garden-planner-dev` (`192.168.0.26`) — Postgres + backend/frontend dev servers, and currently also hosts the bare-metal `infra/deploy/` pipeline (git + systemd + nginx) in lieu of a dedicated test box. No test infrastructure is provisioned yet; `infra/docker-compose.yml` sketches what one could look like.
- Weather data: Open-Meteo (forecast + historical, no API key) and KMI/IRM (Belgian climate normals) for longer-term climate-adjustment planning
## Repo structure (monorepo)
 
```
/backend    FastAPI app, SQLModel models, Alembic migrations
/frontend   React + Vite app (desktop layout + mobile/PWA layout)
/infra      Compose files, Proxmox CT provisioning notes
/data       Plant-database ETL: external sources -> project JSON format -> Postgres import
CLAUDE.md
```
 
## Conventions
 
- Backend: type-annotated Python throughout, Pydantic schemas separate from SQLModel table models where they diverge.
- Frontend: functional components + hooks only, no class components. Canvas editor logic lives in dedicated hooks/modules, kept separate from generic UI components.
- Mobile PWA views are a distinct, simplified route set (logging, agenda, notifications) — not a cut-down version of the canvas editor. Don't try to make the Konva editor responsive down to phone width; build a separate lightweight view instead.
- Every schema change: write the Alembic migration in the same commit as the model change.
- Regenerate the typed frontend API client after backend schema/route changes.
## Commands

**Claude: use the wrapper scripts in `claudeTools/` (PowerShell) instead of typing the raw `cd <dir>; <command>` yourself.** A `cd`-prefixed compound command has a different signature every time depending on which directory you're chaining from, so it can't be pre-approved once - the wrapper scripts have a fixed path and *can* be, which is the whole point. See `claudeTools/README.md` for the full list; the commands below are documented for humans/reference, not for Claude to type directly.

Backend (`cd backend`, uv-managed, Python 3.12, package installs live in `.venv`):
- `uv run uvicorn app.main:app --reload` — run the dev API server (http://localhost:8000, docs at `/docs`) — `claudeTools/backend_dev_start.ps1` (detached) / `backend_dev_stop.ps1`
- `uv run alembic upgrade head` — apply migrations (needs `DATABASE_URL` reachable — see `.env.example`; no Postgres in this local Windows checkout, but verified working against real Postgres on `garden-planner-dev`, see note below) — `claudeTools/backend_migrate.ps1`
- `uv run alembic revision --autogenerate -m "..."` — generate a migration from model changes (no wrapper - message varies every time)
- `uv run pytest` — run tests — `claudeTools/backend_test.ps1`
- `uv run ruff check .` — lint — `claudeTools/backend_lint.ps1`

Frontend (`cd frontend`, npm-managed):
- `npm run dev` — dev server (http://localhost:5173), proxies `/api` to `http://localhost:8000`
- `npm run build` — typecheck (`tsc -b`) + production build — `claudeTools/frontend_build.ps1`
- `npm run lint` — oxlint — `claudeTools/frontend_lint.ps1`
- `npm run generate:api` — regenerate `src/api/schema.d.ts` from the running backend's OpenAPI schema; run this after any backend route/model change, backend must be running — `claudeTools/frontend_generate_api.ps1`

Data/ETL (`cd data`, uv-managed, its own `pyproject.toml` — see `data/etl/CLAUDE.md`):
- `uv run ruff check etl/` — lint — `claudeTools/data_lint.ps1`
- `uv run python -m <module>` (e.g. `etl.run`, `etl.growing_info.run`, `etl.backfill_taxonomy`, `etl.state_report`) — `claudeTools/data_run_module.ps1 <module> [args...]`
- an arbitrary/scratch script that needs `data/` on `PYTHONPATH` — `claudeTools/data_run_script.ps1 <path> [args...]`

`garden-planner-dev` (see `infra/deploy/CLAUDE.md`): `claudeTools/dev_ssh_deploy_backend.ps1`, `dev_ssh_deploy_all.ps1`, `dev_ssh_health.ps1`, `dev_psql.ps1 -File <path>` (run a local `.sql` file against its real Postgres).

Both `npm run dev` and `uv run uvicorn ...` must be running simultaneously for the frontend health check and future API calls to work.

**Note:** no Postgres instance is available in this local Windows dev checkout, so the first migration (`alembic/versions/*_create_bed_table.py`) was hand-written to match `app/models/bed.py` rather than autogenerated. It's now been run and verified against real Postgres 17 on `garden-planner-dev` (`alembic_version` stamped at `8ece1e150dae`, `bed` table confirmed present with the expected columns) — the original version had a real bug (an `Enum` column both explicitly `.create()`d and auto-created again by `create_table` in the same transaction, raising `DuplicateObject`); fixed by dropping the manual `.create()`/`.drop()` calls and letting `create_table`/`drop_table` manage the enum type's lifecycle, which is the standard pattern for an enum used by exactly one table.
 
## Domain notes for planning logic
 
- Succession/rotation should key off crop family (legumes, brassicas, nightshades, roots, alliums, leafy greens) to warn about repeat-family placement and disease carryover, not just individual crop names.
- Companion planting and shade-casting checks depend on bed position/orientation and neighboring plant height — factor sun direction into the layout editor eventually, not just adjacency.
- Compost/fertilization logs should be linkable to specific beds so nutrient history informs next season's crop assignment.

## Development environment
The development machine is `garden-planner-dev` (SSH host alias configured locally, user `deploy`) at `192.168.0.26`, Debian 13 (trixie). There is no separate test server at the moment — see `infra/README.md` and `infra/deploy/CLAUDE.md` for what's actually deployed there and what Claude can/can't do over SSH (only `sudo systemctl restart garden-backend` is passwordless; everything else needs the user to run it interactively).

## License

GPLv3 (see LICENSE).
