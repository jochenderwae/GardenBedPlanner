<#
.SYNOPSIS
Runs an arbitrary Python script (e.g. a one-off scratchpad debug script)
with data/ on PYTHONPATH so `from etl...` imports resolve, regardless of
where the script file itself lives. Equivalent to:
cd data; $env:PYTHONPATH="."; uv run python <Path> <Args...>

.PARAMETER Path
Path to the script to run (absolute, or relative to the caller's cwd).

.EXAMPLE
.claude\skills\run-etl-module\scripts\data_run_script.ps1 C:\path\to\scratch\debug_something.py
#>
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs
)

Set-Location -Path (Join-Path $PSScriptRoot "..\..\..\..\data")
$env:PYTHONPATH = "."
uv run python $Path @ExtraArgs
