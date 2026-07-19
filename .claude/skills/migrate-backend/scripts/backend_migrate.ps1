<#
.SYNOPSIS
Applies pending Alembic migrations. Equivalent to: cd backend; uv run alembic upgrade head

.NOTES
Needs DATABASE_URL reachable. There is no Postgres available on this local
Windows checkout (see root CLAUDE.md) - this only works when DATABASE_URL
points at a real Postgres instance (e.g. garden-planner-dev, or via SSH -
see dev_ssh_deploy_backend.ps1 for applying migrations there instead).
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\backend")
uv run alembic upgrade head
