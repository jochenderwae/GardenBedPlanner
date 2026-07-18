<#
.SYNOPSIS
Runs a local .sql file against garden-planner-dev's real Postgres (the
`garden` app database - same credentials as infra/deploy/config.sh's
defaults) via scp + psql -f, then cleans up the remote temp copy.

Useful for read-only verification queries, or for testing a migration's
raw SQL wrapped in its own BEGIN/ROLLBACK before trusting it against real
data (see the family/genus migration verification for the pattern this
was extracted from).

.PARAMETER File
Path to the local .sql file to run.

.EXAMPLE
claudeTools/dev_psql.ps1 -File C:\path\to\query.sql
#>
param(
    [Parameter(Mandatory = $true)][string]$File
)

$remoteName = "claudetools_" + [System.IO.Path]::GetFileName($File)
scp $File "garden-planner-dev:/tmp/$remoteName"
ssh garden-planner-dev "PGPASSWORD=garden psql -h 127.0.0.1 -U garden -d garden -v ON_ERROR_STOP=1 -f /tmp/$remoteName; rm -f /tmp/$remoteName"
