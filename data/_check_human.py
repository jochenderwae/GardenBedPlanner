import json

data = json.load(open(".cache/openfarm-crops-rescue/crops.json", encoding="utf-8"))
for rec in data:
    if rec.get("slug") == "human-being":
        print(json.dumps(rec, indent=2))
