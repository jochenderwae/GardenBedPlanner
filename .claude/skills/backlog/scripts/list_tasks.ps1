<#
.SYNOPSIS
Read-only: lists every open item with a given role label, grouped by
status, sorted by priority within each group. Backs the "list my tasks"
interaction in SKILL.md.

.PARAMETER Role
One of product-owner | data-engineer | frontend-developer | backend-developer | tester.
#>
param(
  [Parameter(Mandatory = $true)][string]$Role
)
. "$PSScriptRoot\_config.ps1"

if ($ValidRoles -notcontains $Role) { throw "Unknown role '$Role' - expected one of: $($ValidRoles -join ', ')" }

$priorityRank = @{ "urgent" = 0; "high" = 1; "medium" = 2; "low" = 3 }
function Rank($p) {
  if ($null -eq $p -or $p -eq "") { return 4 }
  $k = $p.ToString().ToLower() -replace " ", "-"
  if ($priorityRank.ContainsKey($k)) { return $priorityRank[$k] } else { return 4 }
}

$items = Get-AllProjectItems | Where-Object { $_.labels -contains "role:$Role" }
if (-not $items) {
  Write-Host "No items labeled role:$Role."
  return
}

$grouped = $items | Group-Object -Property status
foreach ($g in $grouped | Sort-Object { if ($_.Name) { $_.Name } else { "zzz" } }) {
  Write-Host "`n=== Status: $(if ($g.Name) { $g.Name } else { '(none)' }) ==="
  $sorted = $g.Group | Sort-Object { Rank $_.priority }
  foreach ($it in $sorted) {
    $areaLabels = ($it.labels | Where-Object { $_ -like "area:*" }) -join ", "
    Write-Host "  #$($it.content.number) [$($it.priority)] $($it.title)  ($areaLabels)"
  }
}
