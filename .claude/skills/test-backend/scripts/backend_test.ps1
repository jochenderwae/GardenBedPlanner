<#
.SYNOPSIS
Runs the backend test suite. Equivalent to: cd backend; uv run pytest
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\backend")
uv run pytest
