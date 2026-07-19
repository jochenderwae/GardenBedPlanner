---
name: deploy-backend
description: Redeploy just the backend to garden-planner-dev (git pull, uv sync, alembic upgrade head, restart the systemd service). Use only when explicitly asked to deploy/redeploy the backend.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\deploy-backend\scripts\dev_ssh_deploy_backend.ps1)
---

**Only run this when the user has explicitly asked to deploy** - this touches the real `garden-planner-dev` box (`infra/deploy/CLAUDE.md`), not a local/reversible action. Don't infer "and deploy" from a build/commit/push request unless it was actually said.

Run `C:\projects\GardenBedPlanner\.claude\skills\deploy-backend\scripts\dev_ssh_deploy_backend.ps1` (`infra/deploy/03-deploy-backend.sh` over SSH: git pull, `uv sync`, `alembic upgrade head`, reinstall+restart the `garden-backend` systemd unit).

Before deploying a migration that touches real data (not a brand-new empty table), confirm the actual row count on `garden-planner-dev` first via `/db-query` rather than assuming from memory - a migration that's correct against an empty table can still be wrong against real rows. See root `CLAUDE.md`'s note on the original `bed` table migration for why this matters.

After it finishes, confirm with `/health-check` (health endpoint + deployed commit/branch). Its service-state check needs sudo and may fail with "a password is required" if `garden-deploy.sudoers` isn't installed - that's a known, harmless gap (see `infra/deploy/CLAUDE.md`), not a deploy failure, as long as the health endpoint itself returns `{"status":"ok"}` and the commit matches what you just pushed.

Push to the remote branch *before* running this (see `/git`) - it pulls from `origin`, not your local working copy.
