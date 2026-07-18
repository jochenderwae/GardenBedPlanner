import sys

from etl.export import build_plant_json, validate
from etl.merge import merge_plant
from etl.run import build_master_list

slug_to_check = sys.argv[1]

ml, per_plant = build_master_list()
records = per_plant.get(slug_to_check)
if not records:
    print(f"No records found for {slug_to_check!r}")
    sys.exit(1)

wr = merge_plant(slug_to_check, records)
plant_json = build_plant_json(wr)
import json

print(json.dumps(plant_json, indent=2))
try:
    validate(plant_json)
    print("VALID")
except Exception as exc:
    print("INVALID:", exc)
