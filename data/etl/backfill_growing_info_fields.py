"""One-off re-run of the growing_information "extract" pass (GitHub issue
#127: "Retrieve periods from growing information").

etl/growing_info/passes.py's extract_pass originally only looked for the
zero-source-coverage fields (composting_needs, fertilizer_needs,
needs_wind_cover, needs_rain_cover, seed_info.pretreatment, bedding_needs -
see data/CLAUDE.md's "Fields still needing a source"). Broadened for this
issue to also mine growing_information for periods, edible_parts,
soil_type, spread_cm, and row_spacing_cm - but every plant with
growing_information already has its "extract" pass checkpointed done in
etl/growing_info/state.py's plant_pass_done table from the original run, so
a plain re-run of `etl.growing_info.run` would skip all of them.

This script does the minimal reset needed to make that re-run actually
redo extraction: resets the "extract" pass checkpoint for every plant that
has growing_information, then delegates the actual regeneration to
etl.growing_info.run.run_passes(None) directly - it already knows how to
skip everything else still correctly checkpointed done (consolidate/
crosscheck/surface for every plant, extract for anything this script didn't
touch) and only re-run what was just reset.

Run from data/: uv run python -m etl.backfill_growing_info_fields
"""

from etl.growing_info import match, run as growing_info_run
from etl.growing_info import state
from etl.growing_info import storage


def _reset_extract_checkpoints() -> int:
    reset_count = 0
    index = match.load_plant_index()
    for entry in index:
        plant_json = storage.load_plant_json(entry.slug)
        if not plant_json.get("growing_information"):
            continue
        state.reset_pass_done(entry.slug, "extract")
        reset_count += 1
    return reset_count


def main() -> None:
    state.init_db()
    reset_count = _reset_extract_checkpoints()
    print(f"[backfill] reset 'extract' pass for {reset_count} plant(s); regenerating via run_passes...")
    growing_info_run.run_passes(None)


if __name__ == "__main__":
    main()
