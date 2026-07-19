---
name: release
description: End-to-end release flow - build, test, commit, push, and deploy across backend/frontend/data as one guided sequence. Use when asked to ship/release/"commit and deploy" everything at once, not for a single-area change.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\release\scripts\dev_ssh_deploy_all.ps1)
---

Composite skill - chains the other skills in this directory, in this order. Each step's own skill still applies (its cautions, its scope) - this just sequences them; it doesn't duplicate their logic.

1. **Build** whatever areas changed: `/build-backend`, `/build-frontend`, `/build-data` as applicable. Stop here if any fails - don't proceed to test/commit/deploy on a broken build.
2. **Test** the same areas: `/test-backend`, `/test-frontend`, `/test-data`. Report honestly if a test area is still a stub (frontend/data, as of this skill's creation) rather than treating a skipped stub as a pass.
3. **Commit and push**: `/git` - stage explicitly by path (never a blanket add), write the commit message, push to the current branch.
4. **Deploy**, only if this was actually asked for as part of "release" (see the gate below):
   - Both backend + frontend changed: run `C:\projects\GardenBedPlanner\.claude\skills\release\scripts\dev_ssh_deploy_all.ps1` directly (one SSH round-trip covering both, via `infra/deploy/deploy.sh`) rather than `/deploy-backend` + `/deploy-frontend` separately.
   - Only one of backend/frontend changed: use that single skill (`/deploy-backend` or `/deploy-frontend`) instead - no need for the combined script.
   - Data changed: `/deploy-data` (separate step regardless - there's no combined variant covering it).
   - Then `/health-check` to confirm.

**Deploying is still an explicit-confirmation action, same as every individual `/deploy-*` skill says.** Being asked to "release" or "ship" is itself that explicit ask (don't ask again if the user already said "release this") - but don't infer a release/deploy from a plain "commit and push" or "build and test" request. If genuinely unsure whether "deploy" is in scope for what was asked, ask rather than guess - deploying is the one step in this chain that touches the real dev server and can't be casually undone.

Before deploying a migration that touches real data, confirm the actual row count on `garden-planner-dev` first (`/db-query`) rather than assuming from memory - same caution `/deploy-backend`/`/migrate-backend` already document.

If any step fails, stop and report clearly which step failed and why - don't silently skip ahead to later steps (e.g. don't deploy code that failed its build).
