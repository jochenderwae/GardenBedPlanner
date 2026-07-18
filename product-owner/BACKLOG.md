# GardenBedPlanner Backlog

Run log (most recent first):
- 2026-07-18: first run. 359-plant ETL export, Plant CRUD API, and Plants Database UI verified in code; ~55 items catalogued across planned/implied/wishlist scope.

---

## Bed & crop planning

- [x] `Bed` data model + CRUD API - basic bed record (name, type, dimensions, position, greenhouse flag) (implemented: `backend/app/models/bed.py`, `backend/app/api/routes/beds.py`, migration `8ece1e150dae_create_bed_table.py`).
- [ ] Bed border geometry (rectangle/polygon in garden space) - `docs/schema.md`'s `PLANTING_BED.border_geometry` (jsonb, rectangle|polygon); current `Bed` model only has flat `width_cm`/`length_cm`/`pos_x`/`pos_y`, no polygon support and no `orientation` field.
- [ ] Bed soil type / sun level / in-greenhouse fields - domain model calls for these on the bed itself (distinct from `has_greenhouse`, which is on the current model); not present on `backend/app/models/bed.py`.
- [ ] WYSIWYG bed/layout canvas editor (`react-konva`) - `frontend/src/pages/Layout.tsx` currently renders one static placeholder dashed rectangle, not connected to the Bed API or draggable/resizable at all.
- [ ] `BedPlanting` model + API - plant placements on a bed (individual/row/field, geometry, planted/removed dates) per `docs/schema.md`; no backend model yet.
- [ ] Succession/rotation warnings by crop family - domain note in root `CLAUDE.md` ("key off crop family... to warn about repeat-family placement"); `Plant.family`/`genus` fields exist and are populated by the ETL (`backend/app/models/plant.py`), but no rotation-check logic exists anywhere yet.
- [ ] Companion planting / shade-casting checks using bed position + orientation - root `CLAUDE.md` domain note; `PlantCompanion` data exists, but no bed-position-aware adjacency/shade logic built.
- [ ] Garden plan (season/year planning: desired plants + quantities, optionally assigned to beds) - `GARDEN_PLAN`/`GARDEN_PLAN_ENTRY` in `docs/schema.md`; no backend model yet.
- [ ] Calendar view of planting-derived actions (sowing/harvesting windows overlaid) - domain model's "Calendar" section; no backend/frontend work started.
- [ ] Actions/tasks model (fertilize, compost, sow, plant, harvest, clear, etc., with due/completed dates and status) - `ACTION` table in `docs/schema.md`; not built.
- [ ] Garden settings (climate zone, location, misc singleton config) - `GARDEN_SETTINGS` in `docs/schema.md`; not built.

## Bed equipment

- [ ] `BedEquipment` model + API - irrigation/trellis/plant-support items, placed-on-bed or in-inventory, with geometry + height (+ water delivery rate for irrigation) per `docs/schema.md`; no backend model yet.
- [ ] Equipment inventory view (unplaced equipment, `bed_id IS NULL`) - no frontend/backend support yet.

## Irrigation

- [ ] Drip irrigation zone planning (equipment records with `water_delivery_lph`, placed as bed equipment) - root `CLAUDE.md` core-scope item; depends on `BedEquipment` (above), not started.
- [ ] Full pipe-network mapping as an alternative to zone-only modeling - explicitly flagged as an open question in `docs/domain-model.md` ("do we want to map out the complete pipe network... input to a control system for valves"); not decided, not built.

## Composting & fertilization

- [ ] `CompostFertilizationLog` model + API, linkable to a bed - root `CLAUDE.md` core-scope item and domain-note ("linkable to specific beds so nutrient history informs next season's crop assignment"); `docs/schema.md` has the table shape; not built.
- [ ] Compost bin tracking (the 2× 1m³ bins mentioned in root `CLAUDE.md`'s garden description) as a first-class concept, e.g. `bed_type = compost_bin` already exists on `Bed` (implemented: `backend/app/models/bed.py`) but no compost-specific fields/workflow (fill state, turn schedule, maturity) beyond the generic bed record.

## Seed guide

- [ ] `SeedInventoryItem` model + API - seed stock by count or weight, linked to a plant - `docs/schema.md`; not built.
- [ ] Seed buying guide / agenda-reminders view - root `CLAUDE.md` core-scope item ("seed buying guide with an agenda/reminders view"); depends on seed inventory + notifications, not started.

## Harvest logs

- [ ] Harvest log model + API (yield, quality, notes, informing next year's planning) - root `CLAUDE.md` core-scope item; no `HarvestLog`-equivalent table in `docs/schema.md` or codebase yet - worth adding to the schema sketch, not just building blind.

## Weather & climate

- [ ] Open-Meteo forecast/historical data import - root `CLAUDE.md` tech-stack note; no fetcher/job in `backend/` yet.
- [ ] KMI/IRM Belgian climate normals import - root `CLAUDE.md` tech-stack note; not built.
- [ ] Climate-adjusted planting-decision logic (using `Plant.min_temperature_c`/`max_temperature_c`, imported weather data) - `Plant` fields exist and are populated (implemented: `backend/app/models/plant.py`, migration `0b5e82fb2a1c`), but nothing consumes them for adjustment logic yet.

## Notifications

- [ ] Web Push notification delivery (VAPID, `pywebpush`) - root `CLAUDE.md` tech-stack note; no push subscription model, no send logic in `backend/`.
- [ ] PWA manifest + service worker (`vite-plugin-pwa`, installable, offline caching, push support) - root `CLAUDE.md` tech-stack note; not present in `frontend/` (no `vite-plugin-pwa` config found).
- [ ] Reminder/agenda checks as a scheduled job - `backend/app/core/scheduler.py` instantiates an `AsyncIOScheduler` and starts/stops it in `main.py`'s lifespan, but zero jobs are registered on it yet - it's wired up but empty.
- [ ] Mobile/PWA simplified route set (logging, agenda, notifications) distinct from the desktop canvas editor - root `CLAUDE.md` convention ("not a cut-down version of the canvas editor"); no distinct mobile routes exist in `frontend/src/router.tsx` yet (only `/`, `/layout`, `/plants`, `/plants/:slug`).

## Plant database

- [x] `Plant` SQLModel cluster (core fields + taxonomy/climate/succession/life-cycle waves) + Alembic migrations (implemented: `backend/app/models/plant.py`; migrations `3badb93e90d7_create_plant_tables`, `0b5e82fb2a1c_add_taxonomy_climate_succession_fields_`, `cd2f3a9b9ded_add_plant_life_cycle`).
- [x] Satellite tables: `PlantDataSource`, `SeedInfo`, `PlantPeriod` (+ `PeriodType` lookup table), `PlantCompanion`, `PlantBeddingNeed`, `PlantPestInteraction`, `PlantGrowingInformation` (implemented: `backend/app/models/plant.py`; migrations `6293e1b8248d_add_plant_growing_information`, `0c586808f5c2_convert_period_type_to_lookup_table`).
- [x] Full CRUD REST API for `Plant` + every satellite table, plus `PeriodType` (implemented: `backend/app/api/routes/plants.py`, `backend/app/api/routes/period_types.py`).
- [x] `data/plant.schema.json` JSON Schema + worked example, mirroring the Postgres schema for ETL output (implemented: `data/plant.schema.json`, `data/plant.example.json`, referenced throughout `data/CLAUDE.md`).
- [x] ETL pipeline: master-list build, per-plant enrichment (Permapeople, Trefle), bulk-source lookups (USDA PLANTS, Wikipedia companions), merge, Ollama conflict resolution, export to validated JSON (implemented: `data/etl/run.py`, `merge.py`, `ollama_resolve.py`, `export.py`, `sources/*.py`).
- [x] First full ETL run completed - 359 plant JSON records in `data/plants/*.json`, sourced from openfarm-crops-rescue, Homesteader Labs, Permapeople, Trefle, USDA PLANTS, and Wikipedia companion data, merged/conflict-resolved via local Ollama (verified: `data/plants/*.json` file count and content; per-run audit trail in `data/conflicts_log.jsonl` per `data/etl/CLAUDE.md`). Currently uncommitted working-tree state as of 2026-07-18.
- [ ] Import script: `data/plants/*.json` → Postgres upsert - `data/etl/CLAUDE.md` still says "not yet built", but a two-pass idempotent importer exists at `backend/app/scripts/import_plants.py` (verified in code) - doc is stale on this point. Left unchecked here because there's no evidence yet that it has actually been *run* against the 359-record export on `garden-planner-dev`'s real Postgres - confirm a run before checking off.
- [x] Plants Database UI: hamburger nav + species/cultivar tree-table (family → genus → plant), autosaving field editor with undo, covering every satellite section (implemented: `frontend/src/pages/PlantsDatabase.tsx`, `frontend/src/pages/PlantDetail.tsx`, `frontend/src/pages/plant-detail/SatelliteSections.tsx`, `frontend/src/components/nav/NavDrawer.tsx`).
- [ ] Project Gutenberg growing-information extraction pipeline (fetch 7 public-domain gardening books, split into sections, match to plants, 4-pass Ollama consolidate/extract/cross-check/surface) - explicitly **schema-only, not wired up yet** per `data/CLAUDE.md` and `data/etl/CLAUDE.md`. Module scaffolding exists (`data/etl/growing_info/{fetch,split,match,passes,storage,state,run}.py`) but is deliberately not connected to the active merge/export pipeline - do not mark done.
- [ ] `composting_needs`, `fertilizer_needs`, `needs_wind_cover`, `needs_rain_cover`, `seed_info.pretreatment`, `bedding_needs` population - fields exist on the model/schema but have zero source coverage from the current ETL sources by design (`data/etl/CLAUDE.md`: "Coverage is intentionally partial"); blocked on the Gutenberg extraction pipeline above.
- [ ] `life_cycle`/`life_cycle_years` population - fields added after the main ETL run; none of the 359 exported plants have them yet, and it's unconfirmed whether Trefle's `main_species` actually has an unmapped duration field to source `life_cycle` from (`data/CLAUDE.md`'s "Fields still needing a source").
- [ ] Seed-catalog sourcing for `seed_info.seeds_per_gram` - no seed-catalog/seed-bank source identified yet (`data/CLAUDE.md`).
- [ ] Cultivar entity below Plant (species) - user request (2026-07-18): when planning a bed, specify a named cultivar (e.g. "Coeur de Boeuf") instead of just the generic species ("Tomato"). Open design question the user raised, unresolved: does cultivar-specific data live on `Plant`, on a new `Cultivar` entity, or does `Cultivar` override `Plant` fields only where set (inheritance/fallback model)? Relevant prior art already in the codebase: `data/etl/CLAUDE.md`'s "cultivar-merge bug fix" already treats cultivars as separate `Plant` records rather than merging them into their species (the Cucurbita pepo squash-family bug) - a real `Cultivar` entity would be a structural change from that, not an extension of it, so needs to reconcile with why that decision was made. Also interacts with `family`/`genus` now being normalized tables (`backend/app/models/plant.py`'s `Family`/`Genus`) and the family→genus tree-table grouping (`frontend/src/pages/PlantsDatabase.tsx`) - a third "cultivar" tier could extend that same UI pattern. Blocks/relates to the not-yet-built `BedPlanting` model above, which is where a cultivar would actually get selected during bed planning.

## Infra & deploy

- [x] Bare-metal deploy pipeline for `garden-planner-dev` (packages, Postgres role/db setup, backend systemd unit, frontend nginx site, redeploy script) (implemented: `infra/deploy/01-install-packages.sh` through `04-deploy-frontend.sh`, `deploy.sh`, `config.sh`, templates).
- [x] `Bed` table Alembic migration verified against real Postgres 17 on `garden-planner-dev` (implemented/verified: `backend/alembic/versions/8ece1e150dae_create_bed_table.py`; per root `CLAUDE.md` and `infra/deploy/CLAUDE.md`, `alembic_version` stamped, table confirmed present).
- [ ] `Plant`-cluster migrations verified against real Postgres on `garden-planner-dev` - `data/CLAUDE.md` still says "pending verification"; no newer note confirming it's since been run for the later migrations (taxonomy/growing-info/life-cycle/period-type waves) - re-check before assuming done.
- [ ] `garden-deploy.sudoers` installed on `garden-planner-dev` - `infra/deploy/CLAUDE.md` explicitly says this must be checked live (`ls /etc/sudoers.d/garden-deploy`), not assumed; status unconfirmed as of this run.
- [ ] Dedicated test infrastructure - `infra/docker-compose.yml`/`.env.example` are reference-only sketches for a possible future test box; `infra/deploy/CLAUDE.md` confirms nothing currently runs them.
- [ ] Backend test suite beyond the health check - only `backend/tests/test_health.py` exists; no tests for Bed/Plant CRUD routes, migrations, or the ETL pipeline.

## Maybe

- [ ] Plant reference photos - listed explicitly in `docs/wishlist.md` as the lead bonus item; tracked here as well since it touches the Plant schema (`Plant`/harvest-log image attachment) directly. No `photo`/`image` field on `Plant` yet.
- [ ] Home Assistant bridge for irrigation automation - `docs/wishlist.md`; bonus scope, not started.
- [ ] Grocy bridge for harvest → food inventory - `docs/wishlist.md`; bonus scope, not started.
- [ ] AI-assisted planting advice - `docs/wishlist.md`; bonus scope, not started.
- [ ] Other homesteading activity tracking (pickling, preserving) - `docs/wishlist.md`; bonus scope, not started.
