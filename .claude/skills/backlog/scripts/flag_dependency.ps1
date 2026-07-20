<#
.SYNOPSIS
Marks an item as blocked by another, using GitHub's native issue-dependency
relationship (visible in the UI as "Blocked by") rather than a body-text
note. Backs the "flag dependency" interaction in SKILL.md.

If the thing you're blocked on ISN'T tracked as its own issue yet, don't
call this - use add_item.ps1 to create it first (product-owner's job to
triage/refine, per SKILL.md), then flag the dependency against its real
number.

.PARAMETER Number
The blocked issue's number.

.PARAMETER DependsOnNumber
The issue number it's blocked by.
#>
param(
  [Parameter(Mandatory = $true)][int]$Number,
  [Parameter(Mandatory = $true)][int]$DependsOnNumber
)
. "$PSScriptRoot\_config.ps1"

gh issue edit $Number --repo $Repo --add-blocked-by $DependsOnNumber
Write-Host "#$Number is now blocked by #$DependsOnNumber."
