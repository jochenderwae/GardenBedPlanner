<#
.SYNOPSIS
Starts the frontend dev server (vite) as a detached process (survives this
tool call ending), logging to frontend/.vite.out.log / .err.log. Proxies
/api to the backend dev server (see vite.config.ts) - run
backend_dev_start.ps1 first if you need API calls to actually resolve.

.PARAMETER Port
Port to run on (default 5173, vite's default, matching root CLAUDE.md).
#>
param(
    [int]$Port = 5173
)

$frontendDir = Join-Path $PSScriptRoot "..\..\..\..\frontend"
Set-Location -Path $frontendDir

# npm on Windows resolves through npm.cmd, not a bare exe Start-Process can
# launch directly - route through cmd.exe (see the project's own Windows-
# tooling notes on this).
Start-Process -WindowStyle Hidden -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev -- --port $Port" `
    -RedirectStandardOutput (Join-Path $frontendDir ".vite.out.log") `
    -RedirectStandardError (Join-Path $frontendDir ".vite.err.log")

Start-Sleep -Seconds 4
try {
    $status = (Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing).StatusCode
    Write-Output "Frontend up on port $Port (HTTP $status)."
} catch {
    Write-Output "Frontend did not respond on port $Port yet - check frontend/.vite.err.log:"
    Get-Content (Join-Path $frontendDir ".vite.err.log") -ErrorAction SilentlyContinue
}
