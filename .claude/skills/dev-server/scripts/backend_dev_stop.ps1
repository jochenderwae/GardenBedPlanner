<#
.SYNOPSIS
Stops any uvicorn dev server process started for this backend (e.g. via
backend_dev_start.ps1).

.NOTES
Same self-match hazard as frontend_dev_stop.ps1 (see that script's own
note): call this on its own, not combined with other text mentioning
"uvicorn" or "app.main:app" in the same PowerShell tool invocation - each
invocation's full command text becomes that child process's own
CommandLine, which this script's own match pattern could then catch.
#>
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "uvicorn" -and $_.CommandLine -match "app\.main:app" } |
    ForEach-Object {
        Write-Output "Stopping PID $($_.ProcessId): $($_.CommandLine)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
