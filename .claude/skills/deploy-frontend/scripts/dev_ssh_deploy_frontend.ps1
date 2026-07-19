<#
.SYNOPSIS
Redeploys just the frontend on garden-planner-dev (git pull, npm ci, npm
run build, reinstall the nginx site). See infra/deploy/CLAUDE.md and
infra/deploy/04-deploy-frontend.sh.

.NOTES
04-deploy-frontend.sh deliberately does NOT git-pull itself (see
infra/deploy/CLAUDE.md's "self-updating-script gotcha" note - only
03-deploy-backend.sh does that, and 04 normally assumes 03 already ran
first). This wrapper pulls explicitly before calling 04 directly, so a
frontend-only deploy still picks up the latest commit instead of silently
rebuilding whatever was last checked out.
#>
ssh -o BatchMode=yes -o ConnectTimeout=10 garden-planner-dev "cd /opt/gardenbedplanner && git fetch origin dev && git checkout dev && git pull --ff-only origin dev && cd infra/deploy && ./04-deploy-frontend.sh"
