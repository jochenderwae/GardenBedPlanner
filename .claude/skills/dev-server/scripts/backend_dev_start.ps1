<#
.SYNOPSIS
Starts the backend dev server as a detached process (survives this tool
call ending), logging to backend/.uvicorn.out.log / .err.log, and waits
for /api/health *and* a real DB-touching endpoint to confirm it came up
with a working database connection, not just that the process is alive.

.PARAMETER Port
Port to run on (default 8000, matching root CLAUDE.md's documented default).

.NOTES
DATABASE_URL: there is no real local Postgres in this Windows checkout (see
root CLAUDE.md), so backend/.env's own DATABASE_URL default
(postgresql+psycopg://garden:garden@localhost:5432/garden) always points at
a database that doesn't exist here. If $env:DATABASE_URL isn't already set
by the caller, default it to TEST_DATABASE_URL's value (garden_test on
garden-planner-dev, reachable directly over the LAN) instead of silently
inheriting the unreachable default - see #203, which found the previous
version of this script let the backend start "successfully" against a
nonexistent database, with /api/health (which never touches the DB)
reporting healthy the whole time while every real route 500'd.
#>
param(
    [int]$Port = 8000
)

$backendDir = Join-Path $PSScriptRoot "..\..\..\..\backend"
Set-Location -Path $backendDir

if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $backendDir ".env"
    $testDbUrl = $null
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^TEST_DATABASE_URL=' } | Select-Object -First 1
        if ($line) { $testDbUrl = $line -replace '^TEST_DATABASE_URL=', '' }
    }
    if ($testDbUrl) {
        $env:DATABASE_URL = $testDbUrl
        Write-Output "DATABASE_URL not set - defaulting to TEST_DATABASE_URL (garden_test) since no local Postgres exists on this checkout."
    } else {
        Write-Output "WARNING: DATABASE_URL not set and no TEST_DATABASE_URL found in backend/.env - the backend will start against its unreachable default (garden:garden@localhost). Set one of these explicitly if you need real DB-backed routes to work."
    }
}

Start-Process -WindowStyle Hidden -FilePath "uv" `
    -ArgumentList "run", "uvicorn", "app.main:app", "--port", $Port `
    -RedirectStandardOutput (Join-Path $backendDir ".uvicorn.out.log") `
    -RedirectStandardError (Join-Path $backendDir ".uvicorn.err.log")

Start-Sleep -Seconds 4
try {
    $health = (Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing).Content
    Write-Output "Health check: $health"
} catch {
    Write-Output "Backend did not respond on port $Port yet - check backend/.uvicorn.err.log:"
    Get-Content (Join-Path $backendDir ".uvicorn.err.log") -ErrorAction SilentlyContinue
    return
}

# /api/health never touches the database - confirm a real DB-backed route
# actually works too, so a misconfigured/unreachable DATABASE_URL doesn't
# read as "backend up" (the exact failure mode #203 documented: /api/health
# green, every real route 500ing with a connection timeout).
try {
    Invoke-WebRequest -Uri "http://localhost:$Port/api/beds" -UseBasicParsing | Out-Null
    Write-Output "Database check: OK (GET /api/beds succeeded)"
} catch {
    Write-Output "WARNING: /api/health is OK but GET /api/beds failed - DATABASE_URL is likely wrong/unreachable. Check backend/.uvicorn.err.log:"
    Get-Content (Join-Path $backendDir ".uvicorn.err.log") -ErrorAction SilentlyContinue -Tail 20
}
