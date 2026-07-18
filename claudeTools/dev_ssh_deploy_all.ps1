<#
.SYNOPSIS
Redeploys both backend and frontend on garden-planner-dev (re-runs steps
03+04, assumes 01+02 already ran once). See infra/deploy/CLAUDE.md and
infra/deploy/deploy.sh.
#>
ssh -o BatchMode=yes -o ConnectTimeout=10 garden-planner-dev "cd /opt/gardenbedplanner/infra/deploy && ./deploy.sh"
