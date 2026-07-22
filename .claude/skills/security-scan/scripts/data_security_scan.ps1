<#
.SYNOPSIS
Runs bandit (Python security static analysis) against data/etl. Equivalent
to: cd data; uv run bandit -r etl -c pyproject.toml
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\data")
uv run bandit -r etl -c pyproject.toml
