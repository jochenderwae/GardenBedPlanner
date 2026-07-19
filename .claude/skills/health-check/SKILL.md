---
name: health-check
description: Check garden-planner-dev's deployed status (health endpoint, deployed commit/branch, service state) without deploying anything. Use when asked to check if the dev server is up, or what's currently deployed.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\health-check\scripts\dev_ssh_health.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\health-check\scripts\dev_ssh_health.ps1` - checks the health endpoint, the deployed git commit/branch, and (best-effort) the `garden-backend` systemd service's active state.

The service-state check needs passwordless sudo and may fail with "a password is required" if `garden-deploy.sudoers` isn't installed on the box (see `infra/deploy/CLAUDE.md`) - that's a known, harmless gap, not a real failure, as long as the health endpoint itself returns `{"status":"ok"}`.

Read-only, safe to run anytime - unlike the `/deploy-*` skills, this makes no changes and needs no explicit ask.
