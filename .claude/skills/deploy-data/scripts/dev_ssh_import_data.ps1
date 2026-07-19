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

`uv` installs to ~/.local/bin (01-install-packages.sh), which is only on
PATH in a shell that's sourced .profile/.bashrc since - not true for a
non-interactive `ssh host "command"` invocation like this one. Same gotcha
03-deploy-backend.sh already works around (see infra/deploy/CLAUDE.md) -
export PATH explicitly rather than assuming `uv` resolves.
#>
ssh -o BatchMode=yes -o ConnectTimeout=10 garden-planner-dev "export PATH=`$HOME/.local/bin:`$PATH && cd /opt/gardenbedplanner/backend && uv run python -m app.scripts.import_plants && uv run python -m app.scripts.import_example_garden"
