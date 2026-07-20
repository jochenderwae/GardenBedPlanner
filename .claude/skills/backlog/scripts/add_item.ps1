<#
.SYNOPSIS
Creates a new backlog issue. Backs the "add item" interaction in SKILL.md,
and doubles as the split-task mechanism via -ParentNumber (see "split task"
in SKILL.md - create the parent first as a plain add_item.ps1 call with no
priority/status of its own, a note that it's a tracking issue, then create
each child with -ParentNumber pointing at it).

.PARAMETER Title
Issue title.

.PARAMETER BodyFile
Path to a text file with the issue body - use a file, not an inline string,
so multi-paragraph context/markdown survives without shell-quoting pain.

.PARAMETER Area
One of the area:* label suffixes (bed-crop-planning, bed-equipment,
irrigation, composting-fertilization, seed-guide, harvest-logs,
weather-climate, notifications, plant-database, infra-deploy, wishlist).

.PARAMETER Roles
Zero or more role names (product-owner/data-engineer/frontend-developer/
backend-developer/tester). Leave empty for an item nobody's picked up yet.

.PARAMETER Priority
low|medium|high|urgent. Omit to leave unset (e.g. for a tracking-only
split-parent issue with no priority of its own).

.PARAMETER Origin
"agent" (starts at Status=New - not yet released, matches "item origin
determines starting status" in the old product-owner conventions) or
"user" (starts at Status=Ready to Start - the user adding it directly is
itself the sign-off, no separate release step needed). Omit entirely for a
tracking-only split-parent/no-status issue.

.PARAMETER ParentNumber
Set this issue as a sub-issue of an existing parent (split-task pattern).
#>
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$BodyFile,
  [Parameter(Mandatory = $true)][string]$Area,
  [string[]]$Roles = @(),
  [string]$Priority,
  [ValidateSet("agent", "user")][string]$Origin,
  [int]$ParentNumber
)
. "$PSScriptRoot\_config.ps1"

foreach ($r in $Roles) { if ($ValidRoles -notcontains $r) { throw "Unknown role '$r' - expected one of: $($ValidRoles -join ', ')" } }
if (-not (Test-Path $BodyFile)) { throw "BodyFile not found: $BodyFile" }

$safeTitle = ConvertTo-SafeArg -Text $Title
$labelArgs = @("--label", "area:$Area")
foreach ($r in $Roles) { $labelArgs += @("--label", "role:$r") }

$createArgs = @("issue", "create", "--repo", $Repo, "--title", $safeTitle, "--body-file", $BodyFile) + $labelArgs
if ($ParentNumber) { $createArgs += @("--parent", "$ParentNumber") }

$url = & gh @createArgs
if ($LASTEXITCODE -ne 0) { throw "gh issue create failed" }
$number = [int]($url -replace ".*/issues/", "")
Write-Host "Created #$number : $Title"

$addResult = gh project item-add $ProjectNumber --owner $Owner --url $url --format json | ConvertFrom-Json
$itemId = $addResult.id

if ($Priority) { Set-PriorityField -ProjectItemId $itemId -PriorityKey $Priority.ToLower() }
if ($Origin -eq "agent") { Set-StatusField -ProjectItemId $itemId -StatusKey "new" }
elseif ($Origin -eq "user") { Set-StatusField -ProjectItemId $itemId -StatusKey "ready-to-start" }

$parentNote = if ($ParentNumber) { $ParentNumber } else { "(none)" }
Write-Host "  -> added to project (priority=$Priority origin=$Origin parent=$parentNote)"
Write-Host "  -> $url"
