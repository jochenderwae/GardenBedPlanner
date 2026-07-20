<#
.SYNOPSIS
Swaps an item's role:* label(s). Backs the "re-assign" interaction in
SKILL.md.

If this would leave an actionable item (status new/ready-to-start/assigned/
started) with more than one role label, that's a sign it needs *splitting*
instead (see add_item.ps1 -ParentNumber and SKILL.md's "split task")- this
script will warn but not block it, since already-tested/verified items are
allowed multiple roles as historical record.

.PARAMETER Number
Issue number.

.PARAMETER NewRole
Role to add (one of the five role names).

.PARAMETER OldRole
Role to remove, if this is a reassignment rather than an addition. Omit to
just add NewRole alongside whatever's already there.
#>
param(
  [Parameter(Mandatory = $true)][int]$Number,
  [Parameter(Mandatory = $true)][string]$NewRole,
  [string]$OldRole
)
. "$PSScriptRoot\_config.ps1"

if ($ValidRoles -notcontains $NewRole) { throw "Unknown role '$NewRole' - expected one of: $($ValidRoles -join ', ')" }
if ($OldRole -and $ValidRoles -notcontains $OldRole) { throw "Unknown role '$OldRole' - expected one of: $($ValidRoles -join ', ')" }

$editArgs = @($Number, "--repo", $Repo, "--add-label", "role:$NewRole")
if ($OldRole) { $editArgs += @("--remove-label", "role:$OldRole") }
gh issue edit @editArgs

$item = Get-ProjectItemByNumber -Number $Number
$roleLabels = $item.labels | Where-Object { $_ -like "role:*" }
$statusKey = ($item.status -replace " ", "-").ToLower()
if ($roleLabels.Count -gt 1 -and $ActionableStatuses -contains $statusKey -and $statusKey -ne "tested" -and $statusKey -ne "ready-for-testing") {
  Write-Host "NOTE: #$Number is now labeled $($roleLabels -join ', ') and still actionable - consider splitting it (see SKILL.md 'split task') rather than leaving one item with multiple active owners."
}
Write-Host "#$Number ($($item.title)): roles now $($roleLabels -join ', ')"
