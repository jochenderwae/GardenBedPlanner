from etl import state

state.init_db()
exported = state.all_slugs_at_or_past("exported")
enriched_only = state.all_slugs_at_or_past("enriched") - exported
print(f"Stuck at 'enriched' (failed export): {len(enriched_only)}")
for slug in sorted(enriched_only):
    print(" -", slug)
