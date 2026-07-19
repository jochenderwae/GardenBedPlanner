<#
.SYNOPSIS
Stops any vite dev server process started for this frontend (e.g. via
frontend_dev_start.ps1). Matches on both "vite" and this repo's path in the
command line, not just "vite" alone, so it doesn't kill an unrelated vite
dev server from a different project on the same machine.

.NOTES
Call this on its own, not combined with other PowerShell-tool commands in
the same invocation that happen to mention "vite" or "GardenBedPlanner" as
literal text (e.g. a follow-up debugging Get-CimInstance query in the same
call). Each PowerShell tool invocation runs as its own child process whose
full submitted command text shows up as *that process's own* CommandLine in
Win32_Process - so a combined call can match and kill its own host process
mid-script (confirmed happening once while testing this script). Run it
standalone, or in a separate tool call from anything mentioning those
strings, and this doesn't come up.
#>
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "vite" -and $_.CommandLine -match "GardenBedPlanner"
} | ForEach-Object {
    Write-Output "Stopping PID $($_.ProcessId): $($_.CommandLine)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
