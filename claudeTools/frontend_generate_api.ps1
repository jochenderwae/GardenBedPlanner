<#
.SYNOPSIS
Regenerates the typed frontend API client (src/api/schema.d.ts) from the
backend's live OpenAPI schema. Equivalent to: cd frontend; npm run generate:api

.NOTES
Requires the backend dev server reachable at http://localhost:8000 first -
run backend_dev_start.ps1 beforehand if it isn't already running.
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\frontend")
npm run generate:api
