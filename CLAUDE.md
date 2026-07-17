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
Bonus/later scope: Home Assistant bridge for irrigation automation, Grocy bridge for harvest → food inventory, AI-assisted planting advice, other homesteading activity tracking (pickling, preserving).
 
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
- Proxmox, Debian 12 LXC containers: `garden-dev` (Postgres + backend + frontend dev servers) and `garden-test` (Docker Compose stack mirroring intended deployment)
- Weather data: Open-Meteo (forecast + historical, no API key) and KMI/IRM (Belgian climate normals) for longer-term climate-adjustment planning
## Repo structure (monorepo)
 
```
/backend    FastAPI app, SQLModel models, Alembic migrations
/frontend   React + Vite app (desktop layout + mobile/PWA layout)
/infra      Compose files, Proxmox CT provisioning notes
CLAUDE.md
```
 
## Conventions
 
- Backend: type-annotated Python throughout, Pydantic schemas separate from SQLModel table models where they diverge.
- Frontend: functional components + hooks only, no class components. Canvas editor logic lives in dedicated hooks/modules, kept separate from generic UI components.
- Mobile PWA views are a distinct, simplified route set (logging, agenda, notifications) — not a cut-down version of the canvas editor. Don't try to make the Konva editor responsive down to phone width; build a separate lightweight view instead.
- Every schema change: write the Alembic migration in the same commit as the model change.
- Regenerate the typed frontend API client after backend schema/route changes.
## Commands

Backend (`cd backend`, uv-managed, Python 3.12, package installs live in `.venv`):
- `uv run uvicorn app.main:app --reload` — run the dev API server (http://localhost:8000, docs at `/docs`)
- `uv run alembic upgrade head` — apply migrations (needs `DATABASE_URL` reachable — see `.env.example`; not yet run against a live Postgres in this environment, see note below)
- `uv run alembic revision --autogenerate -m "..."` — generate a migration from model changes
- `uv run pytest` — run tests
- `uv run ruff check .` — lint

Frontend (`cd frontend`, npm-managed):
- `npm run dev` — dev server (http://localhost:5173), proxies `/api` to `http://localhost:8000`
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run lint` — oxlint
- `npm run generate:api` — regenerate `src/api/schema.d.ts` from the running backend's OpenAPI schema; run this after any backend route/model change, backend must be running

Both `npm run dev` and `uv run uvicorn ...` must be running simultaneously for the frontend health check and future API calls to work.

**Note:** no Postgres instance is available in the current dev environment, so the first migration (`alembic/versions/*_create_bed_table.py`) was hand-written to match `app/models/bed.py` rather than autogenerated, and `alembic upgrade head` has not been run/verified end-to-end yet. Verify it against a real Postgres (e.g. once `garden-dev` exists) before trusting it blindly.
 
## Domain notes for planning logic
 
- Succession/rotation should key off crop family (legumes, brassicas, nightshades, roots, alliums, leafy greens) to warn about repeat-family placement and disease carryover, not just individual crop names.
- Companion planting and shade-casting checks depend on bed position/orientation and neighboring plant height — factor sun direction into the layout editor eventually, not just adjacency.
- Compost/fertilization logs should be linkable to specific beds so nutrient history informs next season's crop assignment.

## License

GPLv3 (see LICENSE).
