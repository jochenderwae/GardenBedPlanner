<#
.SYNOPSIS
Redeploys just the backend on garden-planner-dev (git pull, uv sync,
alembic upgrade head, restart the garden-backend systemd unit).
See infra/deploy/CLAUDE.md and infra/deploy/03-deploy-backend.sh.
#>
ssh -o BatchMode=yes -o ConnectTimeout=10 garden-planner-dev "cd /opt/gardenbedplanner/infra/deploy && ./03-deploy-backend.sh"
