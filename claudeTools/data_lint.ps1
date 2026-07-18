<#
.SYNOPSIS
Runs the data/ETL linter (ruff). Equivalent to: cd data; uv run ruff check etl/
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\data")
uv run ruff check etl/
