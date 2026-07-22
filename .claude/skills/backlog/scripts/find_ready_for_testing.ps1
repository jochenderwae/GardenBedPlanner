<#
.SYNOPSIS
Read-only: lists every open item at Status "Ready for Testing", across all
responsible roles (frontend-developer/backend-developer/data-engineer all
hand off here), sorted by priority. Backs the `tester` agent's "find my next
ticket" step - unlike pick_top_task.ps1 (which claims by role via
Ready to Start -> Assigned), tester's queue is defined by *status*, not by
which role built the item, so it needs its own finder rather than
`pick_top_task.ps1 -Role tester`.

.PARAMETER Role
Optional. Narrow to items also labeled role:<Role> (e.g. only frontend
tickets). Omit to see everything ready for testing regardless of who built it.
#>
param(
  [string]$Role
)
. "$PSScriptRoot\_config.ps1"

if ($Role -and $ValidRoles -notcontains $Role) { throw "Unknown role '$Role' - expected one of: $($ValidRoles -join ', ')" }

$priorityRank = @{ "urgent" = 0; "high" = 1; "medium" = 2; "low" = 3 }
function Rank($p) {
  if ($null -eq $p -or $p -eq "") { return 4 }
  $k = $p.ToString().ToLower() -replace " ", "-"
  if ($priorityRank.ContainsKey($k)) { return $priorityRank[$k] } else { return 4 }
}

$items = Get-AllProjectItems | Where-Object { $_.status -eq "Ready for Testing" }
if ($Role) { $items = $items | Where-Object { $_.labels -contains "role:$Role" } }

if (-not $items) {
  Write-Host "Nothing at Status=Ready for Testing$(if ($Role) { " for role:$Role" })."
  return
}

$sorted = $items | Sort-Object { Rank $_.priority }
foreach ($it in $sorted) {
  $roleLabels = ($it.labels | Where-Object { $_ -like "role:*" }) -join ", "
  $areaLabels = ($it.labels | Where-Object { $_ -like "area:*" }) -join ", "
  Write-Host "#$($it.content.number) [$($it.priority)] $($it.title)  ($roleLabels | $areaLabels)"
}
