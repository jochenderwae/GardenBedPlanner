<#
.SYNOPSIS
Stops any uvicorn dev server process started for this backend (e.g. via
backend_dev_start.ps1).
#>
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "uvicorn app\.main:app" } |
    ForEach-Object {
        Write-Output "Stopping PID $($_.ProcessId): $($_.CommandLine)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
