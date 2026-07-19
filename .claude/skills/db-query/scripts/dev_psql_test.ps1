<#
.SYNOPSIS
Runs a local .sql file directly against the garden_test database on
garden-planner-dev - no SSH/scp hop needed, since Postgres there is now
reachable directly from this laptop (pg_hba.conf opened to the LAN - see
docs/testing-plan.md). Executed via backend's psycopg dependency, since no
local psql client is installed on this Windows checkout.

.PARAMETER File
Path to the local .sql file to run.

.NOTES
Needs TEST_DATABASE_URL set - checks the environment first, then falls back
to backend/.env (see backend/.env.example). Targets garden_test
specifically: a separate, disposable database, independent of the real
deployed app database - safe to freely CREATE/DROP/TRUNCATE. For the real
`garden` database, use dev_psql.ps1 instead (SSH+scp, wrap anything
destructive in BEGIN/ROLLBACK - see db-query's own SKILL.md).

.EXAMPLE
.claude\skills\db-query\scripts\dev_psql_test.ps1 -File C:\path\to\query.sql
#>
param(
    [Parameter(Mandatory = $true)][string]$File
)

Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\backend")
uv run python (Join-Path $PSScriptRoot "run_sql_test.py") $File
