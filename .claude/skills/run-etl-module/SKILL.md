---
name: run-etl-module
description: Run any etl.* Python module by name (e.g. etl.run, etl.state_report, etl.backfill_taxonomy). Use for ad-hoc/one-off ETL entrypoint invocations that don't fit a more specific skill.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\run-etl-module\scripts\data_run_module.ps1 *) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\run-etl-module\scripts\data_run_script.ps1 *)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\run-etl-module\scripts\data_run_module.ps1 <module> [args...]` (`uv run python -m <module>` from `data/`) - covers every `etl.*` entrypoint (`etl.run`, `etl.growing_info.run`, `etl.backfill_taxonomy`, `etl.state_report`, `etl.generate_example_garden`, `etl.verify_garden`, etc.) with one stable wrapper.

For an arbitrary/scratch script (not a package module) that still needs `data/` on `PYTHONPATH` so `from etl...` imports resolve: `C:\projects\GardenBedPlanner\.claude\skills\run-etl-module\scripts\data_run_script.ps1 <path> [args...]`.

Always call by absolute path, never `cd` first - each script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

This is a generic entrypoint, not a substitute for the more specific skills that already cover common cases: `/build-data` (lint), `/test-data` (fixture validation + unit tests once they exist). Use this when the task genuinely needs a specific, named ETL module run that isn't one of those.

Most of these scripts write to `data/plants/*.json` and are designed to be resumable (SQLite-backed checkpointing, see `data/etl/CLAUDE.md`) - if a prior run was interrupted, just re-run the same command rather than trying to reset state. Before running anything that writes to `data/plants/*.json`, check whether another process (e.g. the `data-engineer` subagent) is already writing there - two concurrent writers can silently clobber each other's changes.
