<#
.SYNOPSIS
Validates data/example_garden.json (bed schema shape, planting bounds, bed
overlap, plant_slug references). Equivalent to:
cd data; uv run python -m etl.verify_garden

Exits non-zero if any problem is found - safe to use as a gate after
regenerating the example garden (etl.generate_example_garden).
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\data")
uv run python -m etl.verify_garden
