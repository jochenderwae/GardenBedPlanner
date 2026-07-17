# CLAUDE.md — data

This directory is the home for the plant-database ETL: pulling data from external plant/crop databases, normalizing it into this project's own JSON format, and (eventually) importing that into Postgres. `plant.schema.json` is that JSON format (JSON Schema, one object per plant); `plant.example.json` is a worked example. Per-plant files will eventually live in `data/plants/<slug>.json`; the ETL scripts land here too as that work starts.

Related docs: `docs/domain-model.md` describes what fields a plant record needs; `docs/schema.md` has the target Postgres ER model (`PLANT`, `SEED_INFO`, `PLANT_PERIOD`, `PLANT_COMPANION`, `PLANT_BEDDING_NEED`, `PLANT_DATA_SOURCE`) that both the JSON format and the ETL's output are meant to line up with.

## Goal & plan

**Goal**: build a static plant database (base/reference data) that gets imported into Postgres (`Plant` + satellite tables — `SeedInfo`, `PlantPeriod`, `PlantCompanion`, `PlantBeddingNeed`, `PlantDataSource` — per `docs/schema.md`).

**Plan** (agreed order):
1. Build the `Plant`-cluster SQLModel models + Alembic migration, verify against real Postgres on `garden-planner-dev` (same pattern as the `Bed` migration).
2. Define the JSON format, shaped to mirror that Postgres schema closely so the ETL mapping is close to 1:1.
3. Gather sources (tracked in the table below, starting with `openfarm-crops-rescue`).
4. ETL: external sources → this project's JSON format, with an Ollama pass (running locally on this machine) for merge/cleanup — deliberately kept off Claude to avoid spending tokens on bulk data cleanup.
5. Import script that upserts the finished JSON into Postgres.

**Status**: step 1 done (`backend/app/models/plant.py` + `create_plant_tables` migration, pending verification against real Postgres on `garden-planner-dev`) and step 2 done (`data/plant.schema.json` + `data/plant.example.json`). Step 3 (sources) in progress below.

## Data sources

Candidate and confirmed sources to pull plant data from, kept here as they're found so attribution isn't lost by the time the ETL actually runs — every plant record needs a `PLANT_DATA_SOURCE` entry per the schema, and that has to trace back to something listed here.

| Source | URL | Covers | License / attribution | Status |
|---|---|---|---|---|
| openfarm-crops-rescue | https://github.com/thefullnacho/openfarm-crops-rescue | data structure reference (see `docs/domain-model.md`) and basic overall data | CC0 1.0 Universal | candidate |
| Homesteader Labs' Crop Knowledge Base | https://github.com/thefullnacho/homesteader-labs-next/tree/master/content/crops | botanical names, sun, spacing, sowing methods | public domain | candidate |
| Permapeople | https://permapeople.org/api | broad plant database including companion planting | CC BY-SA 4.0 | candidate |
| USDA PLANTS Database |  | authoritative for taxonomy/family classification, which is exactly what you need for rotation-family logic. Weak on cultivation specifics like spacing or companion planting though | public domain | candidate |
| Wikipedia's "List of companion plants" | https://en.wikipedia.org/wiki/List_of_companion_plants | genuinely well-structured for companion pairs specifically, useful as a cross-check rather than a bulk scrape | CC BY-SA | candidate |
| Trefle |  | usefulness to be confirmed | ? | candidate |

## Notes

- Permapeople api documentation is found here: 'https://permapeople.org/knowledgebase/api-docs/' -
