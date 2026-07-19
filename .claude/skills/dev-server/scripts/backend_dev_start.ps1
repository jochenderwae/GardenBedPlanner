<#
.SYNOPSIS
Starts the backend dev server as a detached process (survives this tool
call ending), logging to backend/.uvicorn.out.log / .err.log, and waits
for /api/health to confirm it came up.

.PARAMETER Port
Port to run on (default 8000, matching root CLAUDE.md's documented default).
#>
param(
    [int]$Port = 8000
)

$backendDir = Join-Path $PSScriptRoot "..\..\..\..\backend"
Set-Location -Path $backendDir

Start-Process -WindowStyle Hidden -FilePath "uv" `
    -ArgumentList "run", "uvicorn", "app.main:app", "--port", $Port `
    -RedirectStandardOutput (Join-Path $backendDir ".uvicorn.out.log") `
    -RedirectStandardError (Join-Path $backendDir ".uvicorn.err.log")

Start-Sleep -Seconds 4
try {
    (Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing).Content
} catch {
    Write-Output "Backend did not respond on port $Port yet - check backend/.uvicorn.err.log:"
    Get-Content (Join-Path $backendDir ".uvicorn.err.log") -ErrorAction SilentlyContinue
}
