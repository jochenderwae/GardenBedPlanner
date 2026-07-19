<#
.SYNOPSIS
Quick smoke check that the FastAPI app actually imports and constructs
cleanly (catches broken imports, route-registration errors, or a bad
Pydantic model definition) without needing a live server or a reachable
Postgres. Equivalent to:
  cd backend; uv run python -c "from app.main import app; ..."

.NOTES
Not a substitute for backend_test.ps1 (pytest) or a live health check
(backend_dev_start.ps1 + /api/health) - this only proves the app object
constructs; it says nothing about runtime/DB-dependent behavior. Useful
after any route/model change, especially on this machine where there's no
local Postgres to actually run the server against.
#>
Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\backend")
uv run python -c "from app.main import app; print(f'OK - app imports cleanly, {len(app.routes)} routes registered')"
