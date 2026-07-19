# GardenBedPlanner Backlog

Run log (most recent first):
- 2026-07-19 (later still): added a `ready-to-start` status between `new` and `assigned` per user request -
  it's the gate the user explicitly wanted: no agent may move an item into `ready-to-start` (or `verified`),
  only the user can, and no agent may act on a `status: new` item even if `responsible` is already set. Items
  the user adds directly start at `ready-to-start` (they've already signed off by adding it); items an agent
  adds start at `new` and need the user's explicit release. Also added an optional `depends-on` tracking
  field so an agent can flag "blocked on another task/role" as a structured value instead of only prose -
  `product-owner` turns an untracked `depends-on` into a real backlog item. Schema documented in
  `.claude/agents/product-owner.md`, interactions in `.claude/skills/backlog/SKILL.md`. **Reverted the 7
  canvas-editor/Vitest items from the previous run's `status: assigned` back to `status: new`** - they were
  set by `product-owner` under the main session's instruction, not by the user's own direct sign-off, so
  under the new rule they were never legitimately released; `priority`/`responsible` stay as already triaged.
  Nothing else changed.
- 2026-07-19 (tracking-fields retrofit): full pass per the updated `.claude/agents/product-owner.md` -
  added a `priority`/`status`/`responsible` tracking line under every active item (skipped `[~]`-dropped
  items, none existed yet). The 18 items previously checked `[x]` were unchecked back to `[ ]` -
  `[x]` now means user-verified (`status: verified`), which is no longer this agent's call - and given
  `status: tested` instead, since they were genuinely confirmed against code, just not signed off by the
  user. Routed the 7 canvas-editor/Vitest items from the last research pass (pan/zoom, live dimension
  labels, snap-consistency-fix + alignment snapping, keyboard shortcuts, scoped undo/redo, multi-select,
  frontend Vitest setup) to `status: assigned` / `responsible: frontend-developer` / `priority: urgent`
  (Vitest setup, pan/zoom - true prerequisites) or `high` (the remaining five), per the user standing up
  a `frontend-developer` subagent now. Two items turned out to need splitting because they'd already
  progressed unevenly across roles since last audited: "Installation-time choice to load example/demo
  garden data" (found `data/etl/generate_example_garden.py`, `data/example_garden.json`,
  `backend/app/scripts/import_example_garden.py`, and `backend/app/api/routes/example_garden.py` +
  `frontend/src/pages/layout/ExampleGardenView.tsx` all now exist, wired into `Layout.tsx` as a read-only
  preview - none of this was reflected in the old single-line item) and "`growth_habit` (plant rendering
  geometry)" (data-engineer's half - `data/plant.schema.json` + `data/etl/populate_growth_habit.py` -
  is done; the backend column/migration/API/frontend-consumption half isn't started). Both original
  items now read `[~] ... (split into: ...)`, each split into 2-4 single-responsible items. Net: 18
  checkboxes flipped `[x]`→`[ ]`, 6 new items added via the two splits, tracking lines added to every
  one of the ~70 resulting active items. Did not retrofit the agent file's bolded-title example format
  (`**Short title**`) - out of scope for this pass, flagging as a possible follow-up.
- 2026-07-19 (deep-dive #2): researched comparable CAD-like/drawing tools (tldraw, Excalidraw,
  Figma, RoomSketcher/Floorplanner, dedicated online garden planners) for concrete UI/UX lessons
  applicable to the WYSIWYG bed/layout editor; wrote `product-owner/research/canvas-editor-cad-lessons.md`
  (distinct from the earlier `wysiwyg-bed-editor.md` build spec - this one mines outside tools and
  cross-checks against verified current code). Verified in code: no pan/zoom, inconsistent grid-snap
  application (rectangle drag only, not resize/polygon/plantings), no live dimension labels during
  drag, no keyboard shortcuts, no undo/redo, no multi-select, and no frontend test runner at all
  (`frontend/package.json` has no vitest/jest). Added 7 new backlog items below (pan/zoom, live
  dimension labels, snap consistency fix + object-edge alignment snapping, keyboard shortcuts,
  scoped undo/redo, multi-select, frontend Vitest setup). Also corrected the PWA manifest line -
  `frontend/vite.config.ts` already configures `VitePWA` (found while reading the file for this
  task), so it's no longer accurate that no config exists.
- 2026-07-19 (later): main session update (not a full audit) after the Garden/Bed model redesign landed - marked done: bed border geometry, bed soil/sun/greenhouse fields, `Planting` (renamed from the backlogged `BedPlanting`), `BedEquipment`, garden settings (folded into a new `Garden` entity, itself added to this list). WYSIWYG editor line updated to reflect rotation/polygon-editing/ruler/tabs landing, with pan/zoom and automated test coverage noted as still open. Added the Google Maps plot-import idea to the Maybe section (also added to `docs/wishlist.md`) per an explicit user request to defer it there rather than build it now.
- 2026-07-19: deep-dive research pass on the WYSIWYG bed/layout canvas editor item only (not a full audit); wrote a phased spec to `product-owner/research/wysiwyg-bed-editor.md` and updated that item's backlog line to point at it. No other items touched this run.
- 2026-07-18: first run. 359-plant ETL export, Plant CRUD API, and Plants Database UI verified in code; ~55 items catalogued across planned/implied/wishlist scope.

---

## Bed & crop planning

- [ ] `Bed` data model + CRUD API - basic bed record (name, type, dimensions, position, greenhouse flag) (implemented: `backend/app/models/bed.py`, `backend/app/api/routes/beds.py`, migration `8ece1e150dae_create_bed_table.py`).
  - `priority: medium` · `status: tested` · `responsible: backend-developer`
- [ ] Bed border geometry (rectangle/polygon in garden space) - `docs/schema.md`'s `PLANTING_BED.border_geometry` (jsonb, rectangle|polygon, with `rotation`); implemented via a shared `Geometry` Pydantic type (`backend/app/models/geometry.py`) and migration `24b3354ed5f4_generalize_bed_geometry.py`, which also replaced the old closed `bed_type` enum with free-text `category` and dropped flat `width_cm`/`length_cm`/`pos_x`/`pos_y` entirely. Frontend: `frontend/src/pages/layout/BedNode.tsx` (rectangle drag/resize/rotate via Konva `Transformer`) + `PolygonEditor.tsx` (shared vertex-drag editor) + `ShapeTypeToggle.tsx` (rectangle default, polygon opt-in).
  - `priority: high` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [ ] Bed soil type / sun level / in-greenhouse fields - same migration as border geometry above added `orientation`/`is_raised`/`soil_type`/`sun_level` (reusing `Plant`'s existing `SunLevel` enum); `has_greenhouse` already existed. All editable in `frontend/src/pages/layout/BedPanel.tsx`.
  - `priority: medium` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [ ] Garden entity (overarching boundary, climate zone, location) - new `Garden` model/API (`backend/app/models/garden.py`, `backend/app/api/routes/garden.py`, migration `c28e1331dad1_create_garden_table.py`), `GET`/`PUT /api/garden` (singular, get-or-create). Not in the original backlog list - added during the same redesign that generalized `Bed`'s geometry, since the frontend work surfaced a real need for an outer-boundary concept distinct from any one bed. Creating a `Garden` auto-creates one matching ground-level `Bed` (`category="Ground"`) as the default "plant directly in the garden" surface - see `docs/schema.md`'s modeling-decisions note on why that's a one-time default, not a persisted FK relationship. Frontend: `GardenBoundary.tsx` + `GardenPanel.tsx` (same rectangle/polygon editing as beds), only editable from the Planters tab.
  - `priority: high` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [ ] WYSIWYG bed/layout canvas editor (`react-konva`) - substantially built out beyond the original phase-0 scope this line described: rectangle drag/resize/**rotate** (was locked to aspect-ratio-preserving resize with no rotation), **polygon shape editing** as an alternative to rectangle (rectangle stays the default), a meter-tick **ruler layer** (`RulerLayer.tsx`, metric-only for now, `formatDistanceCm` isolated for a later imperial variant), and a **Planters/Equipment/Plants tab switcher** (`Layout.tsx`) that gates which object type is draggable/interactive per tab - the mechanism that satisfies the originally-backlogged "locked while editing something else" idea instead of a persisted DB field. Still not done: pan/zoom for a garden with a much larger total footprint than the current 1400×900px canvas comfortably shows, and no automated/visual test coverage (no browser-automation tool was available in the environment this was built in - verified via typecheck/build/lint + OpenAPI schema introspection only). Phased build spec: `product-owner/research/wysiwyg-bed-editor.md`. Outside-tool UI/UX lessons + gap-closing plan (pan/zoom, snapping, undo, etc. broken into the specific items below): `product-owner/research/canvas-editor-cad-lessons.md`.
  - `priority: high` · `status: tested` · `responsible: frontend-developer`
- [ ] Canvas pan/zoom (`Stage` wheel-zoom pointer-relative + drag-to-pan + "fit to garden" action) - known gap in the WYSIWYG editor above; no `Stage` scale/position state anywhere in `frontend/src/pages/layout/` (verified via grep). See `product-owner/research/canvas-editor-cad-lessons.md` phase 1 for a concrete plan (pure `screenToWorld`/`worldToScreen`/`fitViewport` functions + Konva's documented pointer-relative wheel-zoom pattern) and why it's sequenced before the snapping/keyboard items below (screen-px-based snap thresholds only make sense once zoom exists). **Released 2026-07-19**: user confirmed wanting zoom while testing the editor and specifically asked to analyze whether the mouse scroll wheel is a good fit - it is, per this item's own existing plan (Konva's documented pointer-relative wheel-zoom pattern above), so just implement it, no separate analysis needed.
  - `priority: urgent` · `status: ready-for-testing` · `responsible: frontend-developer` (frontend-developer: implemented `frontend/src/pages/layout/viewport.ts` (pure `screenToWorld`/`worldToScreen`/`clampScale`/`zoomAtPoint`/`fitViewport`/`visibleWorldBounds`/`pickTickSpacingCm`), wired `Stage` pan (drag empty canvas)/zoom (Ctrl/Cmd+scroll, pointer-relative) + a "Fit view" button + zoom% readout into `Layout.tsx` for both the "My beds" and "Example garden" Stages; made `RulerLayer.tsx` and `GridLines` viewport-aware (visible-range ticks/lines, scale-compensated stroke/font so they read as constant screen size); fixed two latent scale/pan correctness bugs this surfaced - `BedNode.tsx`/`GardenBoundary.tsx`'s `dragBoundFunc` snap-to-grid (Konva passes it *absolute* stage-px coordinates, not local/world ones) and `PlantPlacementLayer.tsx`'s plant-picker popover screen position (was computed from raw world coords assuming 1cm=1px). No `Vitest` unit tests added - the frontend has no test runner yet (separate backlog item, `status: new`, not actionable this pass); verified via `/build-frontend` (oxlint + tsc + vite build, all clean) only.)
- [ ] Live dimension labels while dragging/resizing a bed or dragging a polygon vertex - known gap; `BedNode.tsx`'s `Transformer` only reports the new size on `onTransformEnd`, not during the gesture. `PolygonEditor.tsx` already has the right imperative-Konva-update pattern for this (`handleVertexDragMove`), just not applied to show a distance readout. See research doc phase 2.
  - `priority: high` · `status: new` · `responsible: frontend-developer`
- [ ] Fix inconsistent grid-snap application + add object-edge alignment snapping - verified gap: `snapToGrid` (10cm grid) only applies to `BedNode.tsx`'s rectangle whole-shape drag, not to `Transformer` resize, not to `PolygonEditor.tsx` vertex/shape drag, not to `PlantPlacementLayer.tsx` planting drag. Two-part fix per research doc phase 3: (1) apply the existing grid-snap helper uniformly everywhere a drag commits a position, (2) add a new `findAlignmentSnap` capability (snap a dragged bed/planting/equipment item to align with another object's edge/center, screen-px threshold scaled by zoom) - directly precedented by RoomSketcher's furniture-to-wall snap and tldraw's shape-edge snap, the highest-value new interaction surfaced by the research.
  - `priority: high` · `status: new` · `responsible: frontend-developer`
- [ ] Keyboard shortcuts: arrow-key nudge, Delete, Escape-to-deselect - no keyboard handling exists anywhere in `frontend/src/pages/layout/` (verified via grep). See research doc phase 4; deliberately a small targeted subset (not full shortcut-tool parity), reusing existing selection/delete/deselect logic rather than inventing new commands.
  - `priority: high` · `status: new` · `responsible: frontend-developer`
- [ ] Undo/redo for canvas geometry moves/resizes (scoped small - not full command-pattern engine) - no undo/redo exists anywhere in the frontend. See research doc phase 5: a small history stack over the four existing geometry-mutation call sites (bed, garden boundary, planting, equipment), inverse-PATCH based, explicitly not covering add/delete or non-geometry field edits in this pass.
  - `priority: high` · `status: new` · `responsible: frontend-developer`
- [ ] Multi-select (marquee + shift-click) for plantings, with bulk delete/move - no multi-select exists; `Transformer.nodes([...])` is only ever called with one node. See research doc phase 6 for why it's scoped to the Plants tab first (plantings are numerous enough to need bulk ops, beds are a small fixed physical set that isn't).
  - `priority: high` · `status: new` · `responsible: frontend-developer`
- [ ] Frontend unit test setup (Vitest) - `frontend/package.json` has zero test tooling (no vitest/jest/testing-library, no test script) - verified this run. Near-zero-cost prerequisite for verifying the pure-function geometry/viewport/snapping logic the above items are deliberately designed around, given no browser-automation tool is available in this dev environment to verify canvas interactions visually. See research doc phase 0.
  - `priority: urgent` · `status: new` · `responsible: frontend-developer`
- [ ] `Planting` model + API - plant placements on a bed (individual/row/field, geometry, planted/removed dates), per `docs/schema.md`'s `BED_PLANTING` (renamed `PLANTING` - implemented: `backend/app/models/planting.py`, `backend/app/api/routes/plantings.py`, migration `7e572c798e71_create_planting_table.py`). `bed_id` is required (not nullable) - see the `Garden`/ground-bed note above for why open-ground planting didn't need a separate garden-space coordinate mode. Frontend: `PlantPlacementLayer.tsx` + `PlantPicker.tsx` (click a bed on the Plants tab, search/pick a plant, drag to reposition, double-click to remove).
  - `priority: high` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [~] Installation-time choice to load example/demo garden data (split into: example-garden fixture generator; example-garden Postgres importer script; example-garden read-only preview; onboarding UI to trigger seeding - see the four items below) - old single-line description was stale: this had progressed unevenly across data-engineer/backend/frontend since it was last written, found while retrofitting tracking fields this run.
- [ ] Example-garden fixture generator + JSON output - invents a realistic garden layout (beds + plant placements) matching the current `Bed`/`Planting` shape, since no real layout is recorded anywhere in the domain notes (implemented: `data/etl/generate_example_garden.py`, `data/example_garden.json`).
  - `priority: medium` · `status: tested` · `responsible: data-engineer`
- [ ] Example-garden Postgres importer script - idempotent get-or-create-by-name importer of the fixture above into the real `Bed`/`Planting` tables, mirroring `import_plants.py`'s pattern (implemented: `backend/app/scripts/import_example_garden.py`). Built, but no evidence yet it's been run against real Postgres on `garden-planner-dev` - confirm a run before raising past `ready-for-testing`.
  - `priority: low` · `status: ready-for-testing` · `responsible: backend-developer`
- [ ] Example-garden read-only preview in the WYSIWYG editor - `GET /api/example-garden` serves the fixture as-is (no DB writes), rendered as a non-interactive overlay layer with hover tooltips (implemented: `backend/app/api/routes/example_garden.py`, `frontend/src/pages/layout/ExampleGardenView.tsx`, wired into `frontend/src/pages/Layout.tsx`).
  - `priority: medium` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [ ] Onboarding UI: ask at first install whether to seed the example garden, wire the answer to the importer script above - not started; needs both a "first install" detection point (backend) and the actual prompt (frontend), genuinely undecided which comes first.
  - `priority: low` · `status: new`
- [ ] Succession/rotation warnings by crop family - domain note in root `CLAUDE.md` ("key off crop family... to warn about repeat-family placement"); `Plant.family`/`genus` fields exist and are populated by the ETL (`backend/app/models/plant.py`), but no rotation-check logic exists anywhere yet.
  - `priority: medium` · `status: new` · `responsible: backend-developer`
- [ ] Companion planting / shade-casting checks using bed position + orientation - root `CLAUDE.md` domain note; `PlantCompanion` data exists, and `Bed.orientation` now exists too (see the soil type/sun level/in-greenhouse line above), but no bed-position-aware adjacency/shade logic built yet.
  - `priority: medium` · `status: new` · `responsible: backend-developer`
- [ ] Garden plan (season/year planning: desired plants + quantities, optionally assigned to beds) - `GARDEN_PLAN`/`GARDEN_PLAN_ENTRY` in `docs/schema.md`; no backend model yet.
  - `priority: medium` · `status: new` · `responsible: backend-developer`
- [ ] Calendar view of planting-derived actions (sowing/harvesting windows overlaid) - domain model's "Calendar" section; no backend/frontend work started.
  - `priority: low` · `status: new`
- [ ] Actions/tasks model (fertilize, compost, sow, plant, harvest, clear, etc., with due/completed dates and status) - `ACTION` table in `docs/schema.md`; not built.
  - `priority: medium` · `status: new` · `responsible: backend-developer`
- [ ] Garden settings (climate zone, location, misc singleton config) - `docs/schema.md`'s originally-separate `GARDEN_SETTINGS` was folded into `Garden` (above) rather than built as its own table when implemented - both are singleton/overarching concerns about the same one garden.
  - `priority: medium` · `status: tested` · `responsible: backend-developer`

## Bed equipment

- [ ] `BedEquipment` model + API - irrigation/trellis/plant-support items, placed-on-bed or in-inventory, with geometry + height (+ water delivery rate for irrigation) per `docs/schema.md` (implemented: `backend/app/models/bed_equipment.py`, `backend/app/api/routes/bed_equipment.py`, migration `208203f155e5_create_bed_equipment_table.py`). Frontend is deliberately simpler than beds/plants - form-based add via `EquipmentPanel.tsx` (choose a bed or leave unassigned/inventory, type, height, water delivery rate), not full drag/resize/rotate; placed items render as static markers (`EquipmentLayer.tsx`) on the Equipment tab.
  - `priority: medium` · `status: tested` · `responsible: backend-developer, frontend-developer`
- [ ] Equipment inventory view (unplaced equipment, `bed_id IS NULL`) - `EquipmentPanel.tsx`'s list shows every equipment item including unassigned ones (labeled "Inventory (unassigned)"); not a separate dedicated view, but the same list covers both cases.
  - `priority: low` · `status: tested` · `responsible: frontend-developer`

## Irrigation

- [ ] Drip irrigation zone planning (equipment records with `water_delivery_lph`, placed as bed equipment) - root `CLAUDE.md` core-scope item; depends on `BedEquipment` (above), not started.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] Full pipe-network mapping as an alternative to zone-only modeling - explicitly flagged as an open question in `docs/domain-model.md` ("do we want to map out the complete pipe network... input to a control system for valves"); not decided, not built.
  - `priority: low` · `status: new`

## Composting & fertilization

- [ ] `CompostFertilizationLog` model + API, linkable to a bed - root `CLAUDE.md` core-scope item and domain-note ("linkable to specific beds so nutrient history informs next season's crop assignment"); `docs/schema.md` has the table shape; not built.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] Compost bin tracking (the 2× 1m³ bins mentioned in root `CLAUDE.md`'s garden description) as a first-class concept, e.g. `bed_type = compost_bin` already exists on `Bed` (implemented: `backend/app/models/bed.py`) but no compost-specific fields/workflow (fill state, turn schedule, maturity) beyond the generic bed record.
  - `priority: low` · `status: new` · `responsible: backend-developer`

## Seed guide

- [ ] `SeedInventoryItem` model + API - seed stock by count or weight, linked to a plant - `docs/schema.md`; not built.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] Seed buying guide / agenda-reminders view - root `CLAUDE.md` core-scope item ("seed buying guide with an agenda/reminders view"); depends on seed inventory + notifications, not started.
  - `priority: low` · `status: new`

## Harvest logs

- [ ] Harvest log model + API (yield, quality, notes, informing next year's planning) - root `CLAUDE.md` core-scope item; no `HarvestLog`-equivalent table in `docs/schema.md` or codebase yet - worth adding to the schema sketch, not just building blind.
  - `priority: low` · `status: new` · `responsible: backend-developer`

## Weather & climate

- [ ] Open-Meteo forecast/historical data import - root `CLAUDE.md` tech-stack note; no fetcher/job in `backend/` yet.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] KMI/IRM Belgian climate normals import - root `CLAUDE.md` tech-stack note; not built.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] Climate-adjusted planting-decision logic (using `Plant.min_temperature_c`/`max_temperature_c`, imported weather data) - `Plant` fields exist and are populated (implemented: `backend/app/models/plant.py`, migration `0b5e82fb2a1c`), but nothing consumes them for adjustment logic yet.
  - `priority: low` · `status: new` · `responsible: backend-developer`

## Notifications

- [ ] Web Push notification delivery (VAPID, `pywebpush`) - root `CLAUDE.md` tech-stack note; no push subscription model, no send logic in `backend/`.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] PWA manifest + service worker (`vite-plugin-pwa`, installable, offline caching, push support) - root `CLAUDE.md` tech-stack note. Correction (2026-07-19, found incidentally while researching the canvas editor): `frontend/vite.config.ts` **does** already configure `VitePWA` (manifest with name/theme/`registerType: "autoUpdate"`, icons array present but empty) - the previous "no config found" note was stale. Still unchecked: bare manifest registration only, no push-notification wiring, no deliberate offline-caching strategy beyond the plugin's defaults, and icons are an empty array.
  - `priority: low` · `status: started` · `responsible: frontend-developer`
- [ ] Reminder/agenda checks as a scheduled job - `backend/app/core/scheduler.py` instantiates an `AsyncIOScheduler` and starts/stops it in `main.py`'s lifespan, but zero jobs are registered on it yet - it's wired up but empty.
  - `priority: low` · `status: started` · `responsible: backend-developer`
- [ ] Mobile/PWA simplified route set (logging, agenda, notifications) distinct from the desktop canvas editor - root `CLAUDE.md` convention ("not a cut-down version of the canvas editor"); no distinct mobile routes exist in `frontend/src/router.tsx` yet (only `/`, `/layout`, `/plants`, `/plants/:slug`).
  - `priority: low` · `status: new` · `responsible: frontend-developer`

## Plant database

- [ ] `Plant` SQLModel cluster (core fields + taxonomy/climate/succession/life-cycle waves) + Alembic migrations (implemented: `backend/app/models/plant.py`; migrations `3badb93e90d7_create_plant_tables`, `0b5e82fb2a1c_add_taxonomy_climate_succession_fields_`, `cd2f3a9b9ded_add_plant_life_cycle`).
  - `priority: medium` · `status: tested` · `responsible: backend-developer`
- [ ] Satellite tables: `PlantDataSource`, `SeedInfo`, `PlantPeriod` (+ `PeriodType` lookup table), `PlantCompanion`, `PlantBeddingNeed`, `PlantPestInteraction`, `PlantGrowingInformation` (implemented: `backend/app/models/plant.py`; migrations `6293e1b8248d_add_plant_growing_information`, `0c586808f5c2_convert_period_type_to_lookup_table`).
  - `priority: medium` · `status: tested` · `responsible: backend-developer`
- [ ] Full CRUD REST API for `Plant` + every satellite table, plus `PeriodType` (implemented: `backend/app/api/routes/plants.py`, `backend/app/api/routes/period_types.py`).
  - `priority: medium` · `status: tested` · `responsible: backend-developer`
- [ ] `data/plant.schema.json` JSON Schema + worked example, mirroring the Postgres schema for ETL output (implemented: `data/plant.schema.json`, `data/plant.example.json`, referenced throughout `data/CLAUDE.md`).
  - `priority: medium` · `status: tested` · `responsible: data-engineer`
- [ ] ETL pipeline: master-list build, per-plant enrichment (Permapeople, Trefle), bulk-source lookups (USDA PLANTS, Wikipedia companions), merge, Ollama conflict resolution, export to validated JSON (implemented: `data/etl/run.py`, `merge.py`, `ollama_resolve.py`, `export.py`, `sources/*.py`).
  - `priority: medium` · `status: tested` · `responsible: data-engineer`
- [ ] First full ETL run completed - 359 plant JSON records in `data/plants/*.json`, sourced from openfarm-crops-rescue, Homesteader Labs, Permapeople, Trefle, USDA PLANTS, and Wikipedia companion data, merged/conflict-resolved via local Ollama (verified: `data/plants/*.json` file count and content; per-run audit trail in `data/conflicts_log.jsonl` per `data/etl/CLAUDE.md`). Currently uncommitted working-tree state as of 2026-07-18.
  - `priority: medium` · `status: tested` · `responsible: data-engineer`
- [ ] Import script: `data/plants/*.json` → Postgres upsert - `data/etl/CLAUDE.md` still says "not yet built", but a two-pass idempotent importer exists at `backend/app/scripts/import_plants.py` (verified in code) - doc is stale on this point. Left unchecked here because there's no evidence yet that it has actually been *run* against the 359-record export on `garden-planner-dev`'s real Postgres - confirm a run before checking off.
  - `priority: medium` · `status: ready-for-testing` · `responsible: backend-developer`
- [ ] Plants Database UI: hamburger nav + species/cultivar tree-table (family → genus → plant), autosaving field editor with undo, covering every satellite section (implemented: `frontend/src/pages/PlantsDatabase.tsx`, `frontend/src/pages/PlantDetail.tsx`, `frontend/src/pages/plant-detail/SatelliteSections.tsx`, `frontend/src/components/nav/NavDrawer.tsx`).
  - `priority: medium` · `status: tested` · `responsible: frontend-developer`
- [ ] Project Gutenberg growing-information extraction pipeline (fetch 7 public-domain gardening books, split into sections, match to plants, 4-pass Ollama consolidate/extract/cross-check/surface) - explicitly **schema-only, not wired up yet** per `data/CLAUDE.md` and `data/etl/CLAUDE.md`. Module scaffolding exists (`data/etl/growing_info/{fetch,split,match,passes,storage,state,run}.py`) but is deliberately not connected to the active merge/export pipeline - do not mark done.
  - `priority: low` · `status: started` · `responsible: data-engineer`
- [ ] `composting_needs`, `fertilizer_needs`, `needs_wind_cover`, `needs_rain_cover`, `seed_info.pretreatment`, `bedding_needs` population - fields exist on the model/schema but have zero source coverage from the current ETL sources by design (`data/etl/CLAUDE.md`: "Coverage is intentionally partial"); blocked on the Gutenberg extraction pipeline above.
  - `priority: low` · `status: new` · `responsible: data-engineer`
- [ ] `life_cycle`/`life_cycle_years` population - fields added after the main ETL run; none of the 359 exported plants have them yet, and it's unconfirmed whether Trefle's `main_species` actually has an unmapped duration field to source `life_cycle` from (`data/CLAUDE.md`'s "Fields still needing a source").
  - `priority: low` · `status: new` · `responsible: data-engineer`
- [ ] Seed-catalog sourcing for `seed_info.seeds_per_gram` - no seed-catalog/seed-bank source identified yet (`data/CLAUDE.md`).
  - `priority: low` · `status: new` · `responsible: data-engineer`
- [~] `growth_habit` (plant rendering geometry) (split into: growth_habit data population; growth_habit backend column/migration/API/frontend consumption - see the two items below) - found while retrofitting tracking fields this run that the data-engineer half of this had already landed, unevenly with the backend half.
- [ ] `growth_habit` data population - shape/size categorization (bush/vine/spreading/upright/rosette/tree) sourced from Trefle's `main_species.specifications.growth_habit`, Ollama-inferred where absent (implemented: `data/plant.schema.json`'s `growth_habit` field, `data/etl/populate_growth_habit.py`). Data-only scope, per `data/CLAUDE.md`'s coverage-table correction note.
  - `priority: medium` · `status: tested` · `responsible: data-engineer`
- [ ] `growth_habit` backend column + migration + API + frontend consumption - lets the WYSIWYG bed editor draw a plant's footprint sensibly instead of a generic circle for everything (verified: no `growth_habit` field on `backend/app/models/plant.py` yet). Feeds the canvas editor's rendering, so sequenced with the editor work above rather than the rest of the plant-database backlog.
  - `priority: high` · `status: new` · `responsible: backend-developer`
- [ ] Cultivar entity below Plant (species) - user request (2026-07-18): when planning a bed, specify a named cultivar (e.g. "Coeur de Boeuf") instead of just the generic species ("Tomato"). Open design question the user raised, unresolved: does cultivar-specific data live on `Plant`, on a new `Cultivar` entity, or does `Cultivar` override `Plant` fields only where set (inheritance/fallback model)? Relevant prior art already in the codebase: `data/etl/CLAUDE.md`'s "cultivar-merge bug fix" already treats cultivars as separate `Plant` records rather than merging them into their species (the Cucurbita pepo squash-family bug) - a real `Cultivar` entity would be a structural change from that, not an extension of it, so needs to reconcile with why that decision was made. Also interacts with `family`/`genus` now being normalized tables (`backend/app/models/plant.py`'s `Family`/`Genus`) and the family→genus tree-table grouping (`frontend/src/pages/PlantsDatabase.tsx`) - a third "cultivar" tier could extend that same UI pattern. Blocks/relates to `Planting` (above), which is where a cultivar would actually get selected during bed planning.
  - `priority: low` · `status: new` · `responsible: product-owner`

## Infra & deploy

- [ ] Bare-metal deploy pipeline for `garden-planner-dev` (packages, Postgres role/db setup, backend systemd unit, frontend nginx site, redeploy script) (implemented: `infra/deploy/01-install-packages.sh` through `04-deploy-frontend.sh`, `deploy.sh`, `config.sh`, templates).
  - `priority: low` · `status: tested` · `responsible: backend-developer`
- [ ] `Bed` table Alembic migration verified against real Postgres 17 on `garden-planner-dev` (implemented/verified: `backend/alembic/versions/8ece1e150dae_create_bed_table.py`; per root `CLAUDE.md` and `infra/deploy/CLAUDE.md`, `alembic_version` stamped, table confirmed present).
  - `priority: low` · `status: tested` · `responsible: backend-developer`
- [ ] `Plant`-cluster migrations verified against real Postgres on `garden-planner-dev` - `data/CLAUDE.md` still says "pending verification"; no newer note confirming it's since been run for the later migrations (taxonomy/growing-info/life-cycle/period-type waves) - re-check before assuming done.
  - `priority: low` · `status: new` · `responsible: tester`
- [ ] `garden-deploy.sudoers` installed on `garden-planner-dev` - `infra/deploy/CLAUDE.md` explicitly says this must be checked live (`ls /etc/sudoers.d/garden-deploy`), not assumed; status unconfirmed as of this run.
  - `priority: low` · `status: new` · `responsible: tester`
- [ ] Dedicated test infrastructure - `infra/docker-compose.yml`/`.env.example` are reference-only sketches for a possible future test box; `infra/deploy/CLAUDE.md` confirms nothing currently runs them.
  - `priority: low` · `status: new` · `responsible: backend-developer`
- [ ] Backend test suite beyond the health check - only `backend/tests/test_health.py` exists; no tests for Bed/Plant CRUD routes, migrations, or the ETL pipeline.
  - `priority: low` · `status: new` · `responsible: backend-developer`

## Maybe

- [ ] Plant reference photos - listed explicitly in `docs/wishlist.md` as the lead bonus item; tracked here as well since it touches the Plant schema (`Plant`/harvest-log image attachment) directly. No `photo`/`image` field on `Plant` yet.
  - `priority: low` · `status: new`
- [ ] Home Assistant bridge for irrigation automation - `docs/wishlist.md`; bonus scope, not started.
  - `priority: low` · `status: new`
- [ ] Grocy bridge for harvest → food inventory - `docs/wishlist.md`; bonus scope, not started.
  - `priority: low` · `status: new`
- [ ] AI-assisted planting advice - `docs/wishlist.md`; bonus scope, not started.
  - `priority: low` · `status: new`
- [ ] Other homesteading activity tracking (pickling, preserving) - `docs/wishlist.md`; bonus scope, not started.
  - `priority: low` · `status: new`
- [ ] Import garden shape/position/size from Google Maps (or similar) instead of drawing the boundary by hand - `docs/wishlist.md`; user request (2026-07-19) during the Garden/Bed redesign, explicitly deferred rather than built alongside that redesign's manual rectangle/polygon `Garden.border_geometry` editor.
  - `priority: low` · `status: new`
