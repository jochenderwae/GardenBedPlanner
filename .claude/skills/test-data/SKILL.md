---
name: test-data
description: Run the data/ETL test suite and fixture validation. Use whenever asked to test, verify, or check the data/ETL code and generated fixtures.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\test-data\scripts\data_verify_garden.ps1) PowerShell(uv run pytest *)
---

**No pytest suite is configured yet** for `data/` as of this skill's creation - `data/pyproject.toml` only has `ruff` as a dev dependency, no `pytest`. See `docs/testing-plan.md` (Phase 1, Data/ETL section) for the concrete plan: `data/tests/` mirroring `data/etl/`'s structure, committed trimmed fixtures under `data/tests/fixtures/` (not the gitignored `.cache/`), mocking `ollama_resolve._call_ollama` for conflict-resolution tests, and the first tests to add (merge logic, schema validation, the `growth_habit` Trefle-nesting regression, the cultivar-merge regression).

Until real unit tests land:

1. Check `data/pyproject.toml`'s `[dependency-groups]` - if `pytest` is now listed (the plan may have been implemented since this skill was written), run `uv run pytest` from `data/` and treat this skill as current, no update needed.
2. Regardless, always run the fixture validator: `C:\projects\GardenBedPlanner\.claude\skills\test-data\scripts\data_verify_garden.ps1` - checks `data/example_garden.json`'s schema shape, planting bounds, bed overlap, and that every `plant_slug` is real. This is real, working verification (not a stub) and should run after any change to `data/etl/generate_example_garden.py` or the garden fixture itself.
3. Also run `/build-data` (ruff) as a baseline correctness check even without unit tests.

If asked to verify plant data quality more broadly, that's a `data-engineer` subagent task (`data/task_queue.md`), not something this skill covers - it's scoped to running existing checks, not designing new ones.

Say explicitly if no real test coverage exists for whatever was asked about, rather than reporting false confidence from lint/fixture-validation alone.
