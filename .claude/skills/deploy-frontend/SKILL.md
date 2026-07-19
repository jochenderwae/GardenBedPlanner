---
name: deploy-frontend
description: Redeploy just the frontend to garden-planner-dev (git pull, npm ci, npm run build, reinstall the nginx site). Use only when explicitly asked to deploy/redeploy the frontend.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\deploy-frontend\scripts\dev_ssh_deploy_frontend.ps1)
---

**Only run this when the user has explicitly asked to deploy** - this touches the real `garden-planner-dev` box (`infra/deploy/CLAUDE.md`), not a local/reversible action.

Run `C:\projects\GardenBedPlanner\.claude\skills\deploy-frontend\scripts\dev_ssh_deploy_frontend.ps1` (git pull, then `infra/deploy/04-deploy-frontend.sh` over SSH: `npm ci && npm run build`, reinstall the nginx site).

If the frontend change depends on a backend schema/route change, deploy the backend first (`/deploy-backend`) - a stale backend serving an old OpenAPI shape doesn't break this deploy, but the deployed frontend and backend should agree with each other in production, same as locally.

Push to the remote branch *before* running this (see `/git`) - it pulls from `origin`, not your local working copy.

Confirm afterward with `/health-check` or a direct check that the site loads.
