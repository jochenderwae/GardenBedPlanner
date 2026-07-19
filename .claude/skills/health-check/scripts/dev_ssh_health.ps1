<#
.SYNOPSIS
Quick status check on garden-planner-dev: backend health endpoint, deployed
git commit/branch, and service active state (best-effort - systemctl
status/is-active need sudo and may prompt for a password if
garden-deploy.sudoers isn't installed, see infra/deploy/CLAUDE.md).
#>
ssh garden-planner-dev "curl -s http://127.0.0.1:8000/api/health; echo; cd /opt/gardenbedplanner && git log --oneline -1; git branch --show-current; sudo -n systemctl is-active garden-backend 2>&1"
