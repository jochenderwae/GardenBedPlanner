<#
.SYNOPSIS
Agent-facing status change. Refuses "ready-to-start" and "verified" - those
are user-only, see mark_ready_to_start.ps1 / mark_verified.ps1. Backs the
"change status" interaction in SKILL.md.

.PARAMETER Number
Issue number.

.PARAMETER Status
One of: new | analyzed | assigned | started | ready-for-testing | tested
(lowercase-hyphenated). `analyzed` is product-owner's own step (see
product-owner.md's "Analyst workflow") - other roles have no real reason to
set it but it isn't hard-blocked, same soft-governance model as the rest of
this system. Moving backward (e.g. tested -> started because testing found
a real problem, or all the way back to `new` because a finding invalidates
the issue's whole prior analysis - e.g. a "fixed"/verified ticket turns out
to still reproduce) is allowed - that's a legitimate correction, not a
mistake to block. This is deliberately safe to do liberally: `new` (and
`analyzed`) both sit below the user-only `ready-to-start` gate, so moving
something back there never lets any agent start unauthorized work - it only
ever adds/corrects what's waiting for the user to release. Just say why in
your `gh issue comment` so the history isn't silently lost.
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
if (-not $StatusOptionIds.ContainsKey($key)) {
  throw "Unknown status '$Status' - expected one of: new, analyzed, assigned, started, ready-for-testing, tested."
}

$item = Get-ProjectItemByNumber -Number $Number
Set-StatusField -ProjectItemId $item.id -StatusKey $key
Write-Host "#$Number ($($item.title)): $($item.status) -> $($StatusDisplayNames[$key])"
