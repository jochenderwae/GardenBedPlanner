<#
.SYNOPSIS
Imports data/plants/*.json and data/example_garden.json into
garden-planner-dev's real Postgres, via the deployed backend's own importer
scripts (backend/app/scripts/import_plants.py,
backend/app/scripts/import_example_garden.py). Run after a
dev_ssh_deploy_backend.ps1 (or dev_ssh_deploy_all.ps1) that pulled in new/
changed data/ content - deploying code doesn't itself re-run these, they're
a separate explicit step.

.NOTES
Order matters: import_example_garden.py's Planting rows FK to Plant.slug,
so import_plants must run first. Both scripts are idempotent
(upsert/delete-then-reinsert), safe to re-run.
#>
ssh -o BatchMode=yes -o ConnectTimeout=10 garden-planner-dev "cd /opt/gardenbedplanner/backend && uv run python -m app.scripts.import_plants && uv run python -m app.scripts.import_example_garden"
