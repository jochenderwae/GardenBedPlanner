<#
.SYNOPSIS
Typechecks and builds the frontend. Equivalent to: cd frontend; npm run build
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\frontend")
npm run build
