<#
.SYNOPSIS
Runs a Python module from the data/ ETL package. Equivalent to:
cd data; uv run python -m <Module> <Args...>

Covers every `etl.*` entrypoint (etl.run, etl.growing_info.run,
etl.backfill_taxonomy, etl.normalize_common_names, etl.state_report, ...)
with one stable, approvable invocation instead of a new one-off command
per script.

.PARAMETER Module
The module to run, e.g. "etl.growing_info.run" or "etl.run".

.EXAMPLE
claudeTools/data_run_module.ps1 etl.growing_info.run
claudeTools/data_run_module.ps1 etl.run --limit 5
claudeTools/data_run_module.ps1 etl.state_report
#>
param(
    [Parameter(Mandatory = $true)][string]$Module,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs
)

Set-Location -Path (Join-Path $PSScriptRoot "..\data")
uv run python -m $Module @ExtraArgs
