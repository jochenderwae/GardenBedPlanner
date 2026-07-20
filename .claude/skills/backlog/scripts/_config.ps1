<#
.SYNOPSIS
Shared constants + helpers for every script in this folder. Dot-source it
first: `. "$PSScriptRoot\_config.ps1"`.

.NOTES
Field/option IDs are opaque GraphQL node IDs from the Project - they don't
change unless someone reconfigures the Project itself (renames/deletes a
field or option). If a script starts failing with "option not found" or
similar, re-run `gh project field-list 1 --owner jochenderwae --format json`
and update the maps below - don't hardcode a workaround in a single script.
#>

$Repo = "jochenderwae/GardenBedPlanner"
$Owner = "jochenderwae"
$ProjectNumber = 1
$ProjectId = "PVT_kwHOAB1Tz84Bd4yR"

$StatusFieldId = "PVTSSF_lAHOAB1Tz84Bd4yRzhYXAP8"
$PriorityFieldId = "PVTSSF_lAHOAB1Tz84Bd4yRzhYYfIU"

# Keys are the lowercase-hyphenated status/priority values used throughout
# this skill's scripts and SKILL.md - matches the old BACKLOG.md vocabulary
# so the migration didn't change how agents talk about status/priority,
# only how it's stored.
$StatusOptionIds = @{
  "new" = "361989db"; "ready-to-start" = "7e83748b"; "assigned" = "ae9f1b25"
  "started" = "59edb4eb"; "ready-for-testing" = "175a6116"; "tested" = "c5266748"; "verified" = "8f39a210"
}
$StatusDisplayNames = @{
  "new" = "New"; "ready-to-start" = "Ready to Start"; "assigned" = "Assigned"
  "started" = "Started"; "ready-for-testing" = "Ready for Testing"; "tested" = "Tested"; "verified" = "Verified"
}
$PriorityOptionIds = @{ "low" = "2e934b0c"; "medium" = "8e1a4713"; "high" = "56f5f31e"; "urgent" = "f97fc1bb" }

# Named $ValidRoles (not $Roles) so scripts whose own parameter is named
# -Roles/-Role don't shadow this when dot-sourcing _config.ps1.
$ValidRoles = @("product-owner", "data-engineer", "frontend-developer", "backend-developer", "tester")

# Status values an agent may act on directly (never "new" - not released -
# and never "ready-to-start"/"verified" - see mark_ready_to_start.ps1 /
# mark_verified.ps1, both user-only by convention).
$ActionableStatuses = @("ready-to-start", "assigned", "started", "ready-for-testing", "tested")

function Get-AllProjectItems {
  # Single full fetch (105 items today, cheap) - every script that needs
  # to filter/sort/find-by-number works off this rather than a narrower
  # query, since gh project item-list has no server-side field filter.
  return (gh project item-list $ProjectNumber --owner $Owner --format json -L 200 | ConvertFrom-Json).items
}

function Get-ProjectItemByNumber {
  param([int]$Number)
  $item = Get-AllProjectItems | Where-Object { $_.content.number -eq $Number }
  if (-not $item) { throw "No project item found for issue #$Number - is it actually added to the project?" }
  return $item
}

function Set-StatusField {
  param([string]$ProjectItemId, [string]$StatusKey)
  if (-not $StatusOptionIds.ContainsKey($StatusKey)) { throw "Unknown status key '$StatusKey' - see `$StatusOptionIds in _config.ps1" }
  gh project item-edit --id $ProjectItemId --field-id $StatusFieldId --project-id $ProjectId --single-select-option-id $StatusOptionIds[$StatusKey] | Out-Null
}

function Set-PriorityField {
  param([string]$ProjectItemId, [string]$PriorityKey)
  if (-not $PriorityOptionIds.ContainsKey($PriorityKey)) { throw "Unknown priority key '$PriorityKey' - see `$PriorityOptionIds in _config.ps1" }
  gh project item-edit --id $ProjectItemId --field-id $PriorityFieldId --project-id $ProjectId --single-select-option-id $PriorityOptionIds[$PriorityKey] | Out-Null
}

function ConvertTo-SafeArg {
  # Embedded double-quotes break native-exe argument passing in PowerShell
  # (the quote is read as a PS quote delimiter, not a literal character) -
  # swap for a straight apostrophe rather than fighting escaping. Learned
  # the hard way during the BACKLOG.md migration.
  param([string]$Text)
  return $Text -replace '"', "'"
}
