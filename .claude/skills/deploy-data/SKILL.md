---
name: deploy-data
description: Import data/plants/*.json and data/example_garden.json into garden-planner-dev's real Postgres via the deployed backend's importer scripts. Use only when explicitly asked to deploy/import/push data changes to the dev server.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\deploy-data\scripts\dev_ssh_import_data.ps1)
---

**Only run this when the user has explicitly asked to deploy/import data** - this writes to the real Postgres database on `garden-planner-dev`, not a local/reversible action.

There is no separate "deploy" step for `data/` the way backend/frontend have one - the JSON files themselves reach the server as part of any `git pull` (e.g. via `/deploy-backend`), but nothing imports them into Postgres automatically. "Deploying data" means re-running the importers against the live database.

Run `C:\projects\GardenBedPlanner\.claude\skills\deploy-data\scripts\dev_ssh_import_data.ps1` (SSHes in and runs, over the deployed backend's own `uv` environment, in this order - order matters, `Planting` FKs to `Plant.slug`):
1. `uv run python -m app.scripts.import_plants`
2. `uv run python -m app.scripts.import_example_garden`

Both are idempotent (upsert / delete-then-reinsert), safe to re-run. Deploy the backend first (`/deploy-backend`) if the model/migration these importers depend on hasn't landed on the server yet - an importer targeting a table that doesn't exist yet will just fail loudly, not corrupt anything.

If a future task adds a new JSON field/entity with its own importer, add that importer's invocation to `.claude/skills/deploy-data/scripts/dev_ssh_import_data.ps1` in the same commit (mirroring how `import_example_garden` was added there) rather than creating a parallel one-off script.
