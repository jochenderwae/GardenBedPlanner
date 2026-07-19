---
name: build-data
description: Lint (ruff) the data/etl ETL codebase. Use whenever asked to build, verify, or check that the data/ETL code is sound.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\build-data\scripts\data_lint.ps1)
---

`data/` has no compiled build step - "build" here means lint clean.

Run `C:\projects\GardenBedPlanner\.claude\skills\build-data\scripts\data_lint.ps1` (ruff over `data/etl/`).

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

Report the result plainly. If it fails, show the actual error output.

If the change touched `data/example_garden.json` or `data/etl/generate_example_garden.py`, also validate the fixture via `/test-data` (fixture-shape/overlap/bounds validation, plus whatever real unit tests `docs/testing-plan.md` adds).

**Boundary note**: if you are the `data-engineer` subagent, your own `.claude/agents/data-engineer.md` already documents this script as your preferred way to run things - this skill is the same command, just also reachable from the main session.
