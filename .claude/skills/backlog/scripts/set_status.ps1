<#
.SYNOPSIS
Agent-facing status change. Refuses "ready-to-start" and "verified" - those
are user-only, see mark_ready_to_start.ps1 / mark_verified.ps1. Backs the
"change status" interaction in SKILL.md.

.PARAMETER Number
Issue number.

.PARAMETER Status
One of: analyzed | assigned | started | ready-for-testing | tested
(lowercase-hyphenated). `analyzed` is product-owner's own step (see
product-owner.md's "Analyst workflow") - other roles have no real reason to
set it but it isn't hard-blocked, same soft-governance model as the rest of
this system. Moving backward (e.g. tested -> started because testing found
a real problem) is allowed - that's a legitimate correction, not a mistake
to block. Just say why in your report so the history isn't silently lost.
#>
param(
  [Parameter(Mandatory = $true)][int]$Number,
  [Parameter(Mandatory = $true)][string]$Status
)
. "$PSScriptRoot\_config.ps1"

$key = $Status.ToLower() -replace " ", "-"
if ($key -eq "ready-to-start" -or $key -eq "verified") {
  throw "'$Status' is user-only - use mark_ready_to_start.ps1 / mark_verified.ps1, and only when the user explicitly asked for it this turn. Refusing."
}
if ($key -eq "new") {
  throw "Setting status back to 'new' isn't a real transition in this system - 'new' means never-released. If this item shouldn't have been actionable, flag it to product-owner instead of forcing this."
}
if (-not $StatusOptionIds.ContainsKey($key)) {
  throw "Unknown status '$Status' - expected one of: analyzed, assigned, started, ready-for-testing, tested."
}

$item = Get-ProjectItemByNumber -Number $Number
Set-StatusField -ProjectItemId $item.id -StatusKey $key
Write-Host "#$Number ($($item.title)): $($item.status) -> $($StatusDisplayNames[$key])"
