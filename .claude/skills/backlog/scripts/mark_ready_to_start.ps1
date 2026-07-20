<#
.SYNOPSIS
USER-ONLY. Sets Status to "Ready to Start" - the gate that makes a New item
actionable by any agent. Only run this when the user has explicitly asked
for it in the current turn; no agent may infer an item is "obviously ready"
and call this on its own initiative, ever.

.PARAMETER Number
Issue number.
#>
param(
  [Parameter(Mandatory = $true)][int]$Number
)
. "$PSScriptRoot\_config.ps1"

$item = Get-ProjectItemByNumber -Number $Number
Set-StatusField -ProjectItemId $item.id -StatusKey "ready-to-start"
Write-Host "#$Number ($($item.title)): $($item.status) -> Ready to Start."
