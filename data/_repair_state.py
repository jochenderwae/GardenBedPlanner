"""One-off repair: restore 'exported' state for every plant whose JSON file
already exists on disk (proof it was successfully exported), after a
debugging script regressed the state DB back to 'master' for everything.
"""

from pathlib import Path

from etl import state
from etl.config import PLANTS_OUT_DIR

state.init_db()

restored = 0
for path in Path(PLANTS_OUT_DIR).glob("*.json"):
    slug = path.stem
    state.set_stage(slug, "exported")
    restored += 1

print(f"Restored 'exported' stage for {restored} plants")
print("progress now:", state.progress_summary())
