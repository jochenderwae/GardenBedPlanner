<#
.SYNOPSIS
Finds the highest-priority actionable item for a role and claims it
(Ready to Start -> Assigned) if it isn't already Assigned/Started/etc.
Backs the "pick top task for me" interaction in SKILL.md.

Never matches Status=New (not released by the user yet) or Status=Verified/
blank (done or a tracking-only split-parent/dropped issue).

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

# Pick-top-task specifically only ever *claims* from Ready to Start or
# Assigned - Started/Ready for Testing/Tested items are already someone's
# active work, not something a fresh "give me a task" call should grab.
$claimableStatuses = @("Ready to Start", "Assigned")

$candidates = Get-AllProjectItems | Where-Object {
  $_.labels -contains "role:$Role" -and $claimableStatuses -contains $_.status
}

if (-not $candidates) {
  Write-Host "Nothing Ready to Start or Assigned for role:$Role. Not picking a New or out-of-role item."
  return
}

$top = $candidates | Sort-Object { Rank $_.priority } | Select-Object -First 1

if ($top.status -eq "Ready to Start") {
  Set-StatusField -ProjectItemId $top.id -StatusKey "assigned"
  Write-Host "Claimed #$($top.content.number): moved Ready to Start -> Assigned."
} else {
  Write-Host "#$($top.content.number) is already Assigned - picking it up as-is."
}

Write-Host "`n--- #$($top.content.number): $($top.title) ---"
Write-Host "Priority: $($top.priority)   Labels: $($top.labels -join ', ')"
Write-Host "URL: $($top.content.url)`n"
gh issue view $top.content.number --repo $Repo --json body -q ".body"
