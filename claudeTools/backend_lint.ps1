<#
.SYNOPSIS
Runs the backend linter (ruff). Equivalent to: cd backend; uv run ruff check .
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\backend")
uv run ruff check .
