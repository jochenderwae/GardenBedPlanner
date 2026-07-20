<#
.SYNOPSIS
USER-ONLY. Sets Status to "Verified" and closes the issue as completed -
the final state, equivalent to the old BACKLOG.md's `[x]` checkbox. Only
run this when the user has explicitly asked for it in the current turn;
never on an agent's own initiative, never inferred from "this looks done."

.PARAMETER Number
Issue number.
#>
param(
  [Parameter(Mandatory = $true)][int]$Number
)
. "$PSScriptRoot\_config.ps1"

$item = Get-ProjectItemByNumber -Number $Number
Set-StatusField -ProjectItemId $item.id -StatusKey "verified"
gh issue close $Number --repo $Repo --reason "completed"
Write-Host "#$Number ($($item.title)): $($item.status) -> Verified, issue closed as completed."
