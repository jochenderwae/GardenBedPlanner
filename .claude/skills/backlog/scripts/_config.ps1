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
# only how it's stored. "analyzed" added 2026-07-21 - product-owner-only,
# sits between new and ready-to-start (see product-owner.md's "analyst"
# workflow: it restructures an issue into the Functional requirements /
# Technical analysis / How to test template before moving it here).
$StatusOptionIds = @{
  "new" = "361989db"; "analyzed" = "f54a05fd"; "ready-to-start" = "7e83748b"; "assigned" = "ae9f1b25"
  "started" = "59edb4eb"; "ready-for-testing" = "175a6116"; "tested" = "c5266748"; "verified" = "8f39a210"
}
$StatusDisplayNames = @{
  "new" = "New"; "analyzed" = "Analyzed"; "ready-to-start" = "Ready to Start"; "assigned" = "Assigned"
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


# --- GraphQL cost control -------------------------------------------------
# A full `gh project item-list` fetch costs ~200 GraphQL points (measured:
# 203 for this ~110-item board) vs. ~1 point for a single-issue targeted
# query (see Get-ProjectItemByNumber). With 4 agents running concurrently,
# each doing several of these per task, the 5000/hr budget drains fast -
# this is what actually exhausted it during the 2026-07-20 GitHub Projects
# migration's first few agent runs. Two mitigations, both here so every
# script gets them for free by dot-sourcing this file:
#   1. Get-AllProjectItems (genuinely needs the whole board - priority
#      sorting across candidates, listing a role's full queue) is cached
#      to disk for a short TTL, shared across every PowerShell process
#      (not just within one script's lifetime), so several agents/scripts
#      querying within the same few seconds share one fetch.
#   2. Get-ProjectItemByNumber (only ever needs ONE issue's project-item
#      id/status/priority - the common case for set_status/mark_*/reassign)
#      no longer fetches the whole board and filters client-side; it uses
#      a targeted GraphQL query scoped to that single issue instead.

$CacheDir = Join-Path $PSScriptRoot ".cache"
$CacheFile = Join-Path $CacheDir "project_items.json"
$CacheTtlSeconds = 20

function Get-AllProjectItems {
  if (Test-Path $CacheFile) {
    $cached = Get-Content $CacheFile -Raw | ConvertFrom-Json
    $age = (Get-Date) - [DateTime]$cached.fetchedAt
    if ($age.TotalSeconds -lt $CacheTtlSeconds) {
      return $cached.items
    }
  }
  $items = (gh project item-list $ProjectNumber --owner $Owner --format json -L 200 | ConvertFrom-Json).items
  if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir | Out-Null }
  @{ fetchedAt = (Get-Date).ToString("o"); items = $items } | ConvertTo-Json -Depth 6 | Set-Content -Path $CacheFile -Encoding utf8
  return $items
}

# A GraphQL query string passed inline via `-f query=$var` gets its embedded
# double-quotes mangled by PowerShell's native-command argument reconstruction
# (same issue as the BACKLOG.md migration's title-quoting bug) - loading it
# from a file via `-f query=@path` sidesteps that entirely, since only the
# file *path* (no embedded quotes) goes through PowerShell's arg-passing.
$TargetedItemQueryPath = Join-Path $PSScriptRoot "_targeted_item_query.graphql"

function Get-ProjectItemByNumber {
  param([int]$Number)
  $repoName = $Repo -replace ".*/", ""
  $result = gh api graphql -F "query=@$TargetedItemQueryPath" -f owner=$Owner -f repo=$repoName -F number=$Number | ConvertFrom-Json
  $issue = $result.data.repository.issue
  if (-not $issue) { throw "No issue found for #$Number in $Repo" }
  $projectNode = $issue.projectItems.nodes | Where-Object { $_.project.number -eq $ProjectNumber }
  if (-not $projectNode) { throw "No project item found for issue #$Number - is it actually added to the project?" }
  return [PSCustomObject]@{
    id = $projectNode.id
    title = $issue.title
    status = $projectNode.status.name
    priority = $projectNode.priority.name
    labels = @($issue.labels.nodes | ForEach-Object { $_.name })
    content = [PSCustomObject]@{ number = $Number }
  }
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
