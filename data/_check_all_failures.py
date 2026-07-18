from etl.export import build_plant_json, validate
from etl.merge import merge_plant
from etl.run import build_master_list
from etl import state

state.init_db()
exported = state.all_slugs_at_or_past("exported")

ml, per_plant = build_master_list()
not_exported = sorted(set(ml.slugs) - exported)
print(f"Not yet exported: {len(not_exported)}")

with open("failure_reasons.txt", "w", encoding="utf-8") as out:
    for slug in not_exported:
        records = per_plant.get(slug, [])
        wr = merge_plant(slug, records)
        plant_json = build_plant_json(wr)
        try:
            validate(plant_json)
            out.write(f"{slug}: now valid?!\n")
        except Exception as exc:
            out.write(f"{slug}: {str(exc).splitlines()[0]}\n")
        out.flush()
