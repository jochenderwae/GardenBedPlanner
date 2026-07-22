<#
.SYNOPSIS
Runs bandit (Python security static analysis) against backend/app. Equivalent
to: cd backend; uv run bandit -r app -c pyproject.toml
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\backend")
uv run bandit -r app -c pyproject.toml
