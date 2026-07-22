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
- Test coverage is being built out per [`docs/testing-plan.md`](docs/testing-plan.md) — backend has pytest (thin coverage so far), frontend/data currently have none. See `.claude/skills/test-*` for the corresponding skills.

## Backlog and subagents

The GitHub Project (https://github.com/users/jochenderwae/projects/1) is the tracked feature backlog — every active item carries `priority`/`status`/`responsible`(/`depends-on`) fields (schema: `.claude/agents/product-owner.md`; interaction conventions: `/backlog` skill). `product-owner/BACKLOG.md` is deprecated as of 2026-07-20 (kept only as historical record). Status flow: `new` → `analyzed` → `ready-to-start` → `assigned` → `started` → `ready-for-testing` → `tested` → `verified`. **Only the user may set `status: ready-to-start` or `status: verified`** — an item stays `new`/`analyzed` (not actionable by any agent, regardless of who it's assigned to) until the user explicitly releases it. Standing rule: editor-related work is prioritized first until told otherwise.

Subagents: `product-owner` (maintains the backlog as an analyst, doesn't write code), `data-engineer` (works `data/task_queue.md`, restricted to `data/` + three narrow exceptions — including keeping `docs/domain-model.md`/`docs/schema.md` accurate and re-rendering `docs/schema-er.png` via `/render-schema` when the diagram changes), `frontend-developer`/`backend-developer` (pick up `role:frontend-developer`/`backend-developer` items once `ready-to-start`, restricted to `frontend/`/`backend/` respectively; `backend-developer` verifies every migration against the real `garden_test` database before deploying it for real), `tester` (tests every item at `status: ready-for-testing` regardless of which role built it, across both `backend/tests/` and `frontend/` — including installing new test tooling like Playwright when a ticket genuinely needs it — but never edits application code itself), `ui-ux-designer` (prepares design-specced tickets for `frontend-developer` and periodically evaluates screens; writes only to `ui-ux-designer/` and the backlog, never `frontend/` itself), `code-reviewer` (whole-repo lean/clean/readability sweeps, applying fixes directly), `security-analyst` (whole-repo vulnerability hunting and remediation — calibrated to this app's intentional single-user/no-auth-in-v1 scope, never proposes adding auth as a "fix").

**Standing "commit/push/deploy without asking" exceptions to the "always confirm before deploying" rule below**: `frontend-developer` and `backend-developer` (granted 2026-07-19/2026-07-20, each restricted to its own directory, `backend-developer` additionally running Alembic migrations against the real database) and, as of 2026-07-21, `code-reviewer` and `security-analyst` — the latter two aren't restricted to one directory, so their exception is conditioned on a full backend+frontend+data build/test regression pass (not just the area actually touched) passing clean before every single commit; see each agent's own definition for the exact steps, and don't relax that condition even though the authorization itself matches frontend/backend-developer's. No other subagent has this exception — every other agent's default is to confirm before committing, same as the main assistant.

## Commands

**Claude: prefer the Skills in `.claude/skills/` (`/build-backend`, `/deploy-frontend`, `/git`, etc. - see `.claude/skills/README.md` for the full list) over typing raw commands yourself.** Each skill is a thin wrapper around one or more PowerShell scripts colocated with it at `.claude/skills/<name>/scripts/*.ps1` - use the skill, not the raw `cd <dir>; <command>` pattern, and not a script directly unless a skill doesn't cover it yet. A `cd`-prefixed compound command has a different signature every time depending on which directory you're chaining from, so it can't be pre-approved once - the scripts have a fixed absolute path and *can* be, which is what the skills build on. The commands below are documented for humans/reference, not for Claude to type directly.

Backend (`cd backend`, uv-managed, Python 3.12, package installs live in `.venv`):
- `uv run uvicorn app.main:app --reload` — run the dev API server (http://localhost:8000, docs at `/docs`) — `/dev-server`
- `uv run alembic upgrade head` — apply migrations (needs `DATABASE_URL` reachable — see `.env.example`; no Postgres in this local Windows checkout, but verified working against real Postgres on `garden-planner-dev`, see note below) — `/migrate-backend`
- `uv run alembic revision --autogenerate -m "..."` — generate a migration from model changes (no wrapper - message varies every time)
- `uv run pytest` — run tests — `/test-backend`
- `uv run ruff check .` — lint — `/build-backend`
- `uv run python -c "from app.main import app; ..."` — smoke-check the app imports/constructs cleanly (no server/Postgres needed) — also `/build-backend`
- `uv run bandit -r app -c pyproject.toml` — Python security static analysis — `/security-scan`

Frontend (`cd frontend`, npm-managed):
- `npm run dev` — dev server (http://localhost:5173), proxies `/api` to `http://localhost:8000` — `/dev-server`
- `npm run build` — typecheck (`tsc -b`) + production build — `/build-frontend`
- `npm run lint` — oxlint — also `/build-frontend`
- `npm run generate:api` — regenerate `src/api/schema.d.ts` from the running backend's OpenAPI schema; run this after any backend route/model change, backend must be running — `/generate-api`

Data/ETL (`cd data`, uv-managed, its own `pyproject.toml` — see `data/etl/CLAUDE.md`):
- `uv run ruff check etl/` — lint — `/build-data`
- `uv run bandit -r etl -c pyproject.toml` — Python security static analysis — `/security-scan`
- `uv run python -m <module>` (e.g. `etl.run`, `etl.growing_info.run`, `etl.backfill_taxonomy`, `etl.state_report`, `etl.generate_example_garden`, `etl.verify_garden`) — `/run-etl-module`
- validating `data/example_garden.json` after regenerating it — `/test-data`

`garden-planner-dev` (see `infra/deploy/CLAUDE.md`): `/deploy-backend`, `/deploy-frontend`, `/deploy-data` (import `data/plants/*.json` + `data/example_garden.json` into the real Postgres via the deployed backend's importer scripts), `/health-check`, `/db-query` (run a local `.sql` file against its real Postgres). `/release` chains build/test/commit-push/deploy across all three areas as one guided flow.

**CI** (`.github/workflows/ci.yml`, added 2026-07-21): runs build+lint+test+bandit for backend/frontend/data on every push, via a GitHub-hosted runner with an ephemeral Postgres service container for backend integration tests. Pure validation — no deploy step, no secrets, no access to `garden-planner-dev`; deploys stay exactly what they already were, explicit `/deploy-*` skill runs. This is a safety net on top of (not instead of) each agent's own pre-commit verification.

Both `npm run dev` and `uv run uvicorn ...` must be running simultaneously for the frontend health check and future API calls to work.

**Note:** no Postgres instance is available in this local Windows dev checkout, so the first migration (`alembic/versions/*_create_bed_table.py`) was hand-written to match `app/models/bed.py` rather than autogenerated. It's now been run and verified against real Postgres 17 on `garden-planner-dev` (`alembic_version` stamped at `8ece1e150dae`, `bed` table confirmed present with the expected columns) — the original version had a real bug (an `Enum` column both explicitly `.create()`d and auto-created again by `create_table` in the same transaction, raising `DuplicateObject`); fixed by dropping the manual `.create()`/`.drop()` calls and letting `create_table`/`drop_table` manage the enum type's lifecycle, which is the standard pattern for an enum used by exactly one table.
 
## Domain notes for planning logic
 
- Succession/rotation should key off crop family (legumes, brassicas, nightshades, roots, alliums, leafy greens) to warn about repeat-family placement and disease carryover, not just individual crop names.
- Companion planting and shade-casting checks depend on bed position/orientation and neighboring plant height — factor sun direction into the layout editor eventually, not just adjacency.
- Compost/fertilization logs should be linkable to specific beds so nutrient history informs next season's crop assignment.

## Development environment
The development machine is `garden-planner-dev` (SSH host alias configured locally, user `deploy`) at `192.168.0.26`, Debian 13 (trixie). There is no separate test server at the moment — see `infra/README.md` and `infra/deploy/CLAUDE.md` for what's actually deployed there and what Claude can/can't do over SSH (only `sudo systemctl restart garden-backend` is passwordless; everything else needs the user to run it interactively).

**`garden_test`** (added 2026-07-19): a dedicated Postgres role/database on `garden-planner-dev`, separate from the real app database (`garden`), reachable directly from this Windows checkout over the LAN (`pg_hba.conf` was opened for it — no SSH needed). `TEST_DATABASE_URL` in `backend/.env` (see `.env.example`) holds the connection string. Use it — via `/migrate-backend` (point `DATABASE_URL` at `TEST_DATABASE_URL`'s value) and `/db-query`'s `dev_psql_test.ps1` — to actually run and verify a migration against a real Postgres before shipping it, instead of relying on lint/typecheck alone the way earlier backend work had to.

## License

GPLv3 (see LICENSE).
