<#
.SYNOPSIS
Runs the frontend linter (oxlint). Equivalent to: cd frontend; npm run lint
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\frontend")
npm run lint
