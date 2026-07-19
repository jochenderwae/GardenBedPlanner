# WYSIWYG bed/layout canvas editor — research & phased spec

Deep-dive for the backlog item "WYSIWYG bed/layout canvas editor (`react-konva`)" in
`product-owner/BACKLOG.md`'s Bed & crop planning section. Written while the main session is
starting the build, alongside a `data-engineer` pass producing `growth_habit` plant-rendering
data and `data/example_garden.json`.

**Caveat on the "outside research" section**: `WebSearch`/`WebFetch` were not actually available
in this run despite being listed in the agent's tool grant (`.claude/agents/product-owner.md`) —
every call errored with "tool not enabled in this context." Section 2 is therefore written from
general/trained knowledge of these tools and libraries, not live-verified sources. Treat it as
directionally useful, not gospel — a follow-up pass with working web tools should confirm/update
the specifics (especially exact GrowVeg/Seedtime UI behavior and current react-konva API
details) before leaning on it for anything load-bearing.

## 1. What this codebase has already decided

**Domain notes (root `CLAUDE.md`)** the editor eventually needs to serve:
- Succession/rotation warnings keyed off crop **family**, not individual species.
- Companion planting / shade-casting checks depend on **bed position + orientation** and
  **neighboring plant height** — sun direction needs to factor into the layout eventually.
- Drip irrigation is planned as **zone** placement (equipment on beds), not necessarily a full
  pipe network — see the open question below.

**`docs/domain-model.md`**: a bed has a border (rectangle or polygon), an orientation (indicating
north), size, height, ground-level/raised, soil type, sun level, composting/fertilization info,
and a greenhouse flag. Plants placed on a bed can be modeled individually, as rows, or as fields
— user's choice. Equipment (irrigation, trellises, supports) has its own polygon/line geometry,
a height, and (for irrigation) a delivery rate; the domain model itself flags the pipe-network
question as unresolved ("do we want to map out the complete pipe network... input to a control
system for valves").

**`docs/schema.md`** is further along than the domain model and is the more precise reference:
- `PLANTING_BED.border_geometry` is `jsonb`, `rectangle | polygon`, **garden-space** coordinates
  (absolute, origin at a fixed reference point, e.g. NW corner of the plot), centimeters, no CRS.
- `BED_PLANTING.geometry` / `BED_EQUIPMENT.geometry` are `jsonb`, **bed-local** coordinates
  (origin at the bed's own bounding-box top-left, unrotated) — `point | line | polygon` depending
  on `placement_type`/equipment shape.
- The two coordinate spaces are explicitly designed to match how Konva nests groups: "The
  frontend positions each bed's Konva `Group` using `border_geometry` and renders
  plantings/equipment as children in that group's local coordinates, so it doesn't have to
  re-derive offsets." This is a real, already-made design decision — build to it, don't reinvent
  a coordinate scheme.
- Shape discriminated union: `point | line | rectangle | polygon`, with `rotation` (degrees,
  clockwise) valid **only** on `rectangle` — polygon vertices already encode rotation directly.
- `border_geometry`/`orientation` are explicitly **not yet on the real `Bed` model**. `schema.md`
  itself notes `width_cm`/`length_cm` were "dropped in favor of deriving footprint from
  border_geometry" in the *sketch*, but the actual implemented model
  (`backend/app/models/bed.py`) still has flat `width_cm`, `length_cm`, `pos_x`, `pos_y` and no
  `orientation`, `border_geometry`, `soil_type`, or `sun_level`. That's real implemented
  state, not a doc going stale — the schema sketch is ahead of the code here, not behind it.
- Open question, explicitly unresolved: full pipe-network mapping vs. zone-only equipment
  modeling for irrigation.

**Current code state**:
- `Bed` (`backend/app/models/bed.py`): `id`, `name`, `bed_type` (enum: `large_planter` |
  `small_planter` | `berry_row` | `compost_bin` | `fruit_tree`), `width_cm`, `length_cm`,
  `height_cm`, `has_greenhouse`, `pos_x`, `pos_y`, `notes`. No polygon, no rotation, no
  orientation, no soil/sun fields.
- `backend/app/api/routes/beds.py`: full CRUD (`GET /beds`, `GET /beds/{id}`, `POST /beds`,
  `PATCH /beds/{id}` — partial update via an auto-generated `BedUpdate` model, `DELETE
  /beds/{id}`). Already solid and generic; no reason to change it for a rectangle-only phase 0.
- `frontend/src/api/client.ts` **already has** `listBeds`/`createBed`/`updateBed`/`deleteBed`
  wired to typed schema types (`Bed`, `BedUpdate`, `BedType` from `./schema`) — the data-fetching
  layer for phase 0 doesn't need to be invented, just consumed via `@tanstack/react-query` (see
  `frontend/src/pages/PlantsDatabase.tsx`'s `useQuery`/`useMutation` pattern for the idiom already
  used elsewhere in this codebase).
- `frontend/src/pages/Layout.tsx` is a static placeholder: one hardcoded dashed `Rect` in a
  fixed-size `Stage`, no data binding, no interactivity.
- No `BedPlanting` model exists yet (plant placements) — blocks any in-bed plant rendering.
- No `Plant.growth_habit` column/API/frontend consumption yet — `data-engineer` is producing the
  underlying category data (`data/plant.schema.json` + `data/plants/*.json`) in parallel, but
  wiring it into the backend/frontend is explicitly *not* that task's scope (see
  `data/task_queue.md` item 1) and isn't started.
- `data/example_garden.json` (in progress, `data-engineer` item 2) is a **dev/demo fixture only**
  — matches the real `Bed` fields for the bed records, but its `plantings` array is illustrative
  JSON, not backed by any table (`BedPlanting` doesn't exist), and nothing imports it into
  Postgres yet.
- No undo/redo utility exists yet anywhere in the frontend despite the backlog's Plants Database
  entry mentioning "undo" — that page's actual mechanism is a snackbar/reflect-external-change
  pattern in `frontend/src/pages/plant-detail/FieldInput.tsx` (single-field revert on save-error
  reflecting an external change), not a general command-stack undo system. Don't assume a
  reusable undo primitive exists to borrow from; one would need to be built for the canvas editor
  specifically if wanted (see phase 0 recommendation below).

## 2. Outside research (general knowledge, not live-verified this run)

### Comparable garden-planning tools

- **GrowVeg / Vegetable Garden Planner** (the most direct comparable — a drag-and-drop
  square-foot/bed planner): plants are dragged from a palette onto a grid-based bed; each plant
  icon is drawn at its *actual mature footprint* (a circle sized to spacing/spread), so
  overcrowding is visually self-evident rather than needing a separate validation pass. It
  overlays a grid (imperial or metric) for scale reference, offers a "companion planting"
  highlight mode that colors icons green/red when hovering a plant, and a rotation-planner mode
  that recolors beds by crop family across a multi-year plan to flag repeats. Beds themselves are
  simple rectangles (occasionally L-shapes via multiple rectangles) — full arbitrary-polygon beds
  are rare in these tools; most gardeners' beds are close enough to rectangular that free-form
  polygon editing is more complexity than value for the common case.
- **Seedtime, Smart Gardener** and similar mobile-first apps de-emphasize the canvas almost
  entirely in favor of checklist/calendar views, treating layout as a lightweight sketch rather
  than a precise CAD-like tool. This lines up with this project's own convention (root
  `CLAUDE.md`): the mobile/PWA route set is meant to be a *separate*, simplified experience
  (agenda/logging), not a shrunk-down canvas — reinforces that the canvas editor is a desktop-first
  concern and shouldn't be designed to also work at phone width.
- **Permaculture/garden-design desktop tools** (e.g. various "garden design software" products)
  lean more CAD-like: full polygon beds, sun-path/shadow simulation overlays, zone/sector
  mapping. That level of fidelity is out of scope here — this app's garden is a fixed, small set
  of mostly-rectangular planters, not an open landscape design problem.

**Takeaway for this project**: rectangle-first bed geometry with real mature-size plant icons and
a family-based color/warning overlay is the well-trodden, low-risk pattern. Full polygon beds and
sun-path simulation are the more elaborate end of the spectrum and match tools built for a
fundamentally more open-ended design problem than "lay out 4 known planters, 3 small planters, a
berry row, 2 compost bins, 2 trees."

### react-konva patterns and gotchas (general knowledge)

- **Drag**: set `draggable` on the shape/`Group`; use `dragBoundFunc` to clamp/snap position
  (e.g. round to the nearest 5 or 10cm grid, or clamp within the garden canvas bounds) rather
  than post-processing after `onDragEnd` — it gives live visual snapping during the drag, not
  just on release.
- **Resize/rotate**: Konva's `Transformer` node attached to a selected shape's ref is the
  standard approach, not hand-rolled resize handles. Common gotcha: `Transformer` resizing
  changes `scaleX`/`scaleY`, not `width`/`height` directly — the usual fix is an
  `onTransformEnd` handler that reads the scale, multiplies it into the real width/height, and
  resets `scaleX`/`scaleY` back to 1, so the persisted data model stays in plain
  width/height/rotation rather than accumulating scale factors.
- **Multi-select**: `Transformer` natively accepts an array of nodes (`transformer.nodes([...])`)
  — a rubber-band/marquee selection (drag on empty canvas to select all shapes intersecting a
  rectangle) is the common UX for entering multi-select, with shift-click to toggle individual
  items.
- **Coordinate nesting**: exactly what `docs/schema.md` already specifies — a `Group` per bed
  positioned in garden-space (from `border_geometry`/`pos_x`,`pos_y`), with children (plantings,
  equipment) using bed-local coordinates. This is a genuinely idiomatic Konva pattern, not just
  convenient for this project — nested Groups avoid manually adding parent offsets to every child
  shape.
- **Grid snapping**: usually implemented as a pure function `snapToGrid(value, gridSizeCm)` used
  inside `dragBoundFunc` and again in resize handlers — keep it as one shared utility so bed
  drag/resize and (later) plant placement all snap consistently.
- **Undo/redo**: no built-in Konva primitive; the common approach for a small-scale editor like
  this is a linear history stack of full-state snapshots (or of small "command" objects with
  do/undo pairs) kept in application state (e.g. Zustand, or even a `useReducer`), *not* trying
  to diff the Konva scene graph itself. Given this project already uses TanStack Query for server
  state, a reasonable lighter-weight option for phase 0 specifically: treat each committed
  drag/resize as its own mutation, and "undo" as re-issuing the inverse PATCH from a small local
  stack of "last N committed mutations" — simpler than a generic command-pattern engine, though
  it won't generalize as cleanly once phase 2/3 add plant placement, multi-object moves, etc. Full
  command-stack undo is the more future-proof choice if undo is wanted at all in the canvas (the
  backlog doesn't currently commit to it — worth the human deciding whether canvas undo is
  in scope at all before over-building it).
- **Performance with many small shapes**: relevant once plant placements (phase 2) put dozens of
  small shapes per bed on screen. Standard mitigations: separate static/background content
  (grid lines, path outlines) onto its own `Layer` with `listening={false}` so Konva doesn't
  hit-test it; avoid one `Layer` per shape (expensive — Konva layers are actual DOM canvas
  elements); batch redraws (`layer.batchDraw()`) rather than triggering a full redraw per shape
  update during drag; consider `Konva.Node.cache()` for complex plant icons that don't change
  shape often. This project's actual scale (a handful of beds, a few dozen plant placements total
  across the whole garden) is comfortably within what plain react-konva handles without any of
  this being urgent — worth knowing the levers exist, not worth building preemptively.
- **z-ordering**: `moveToTop()`/`zIndex` are straightforward but worth deciding a convention early
  (e.g. bed borders always below plantings, plantings below equipment overlay, selected object
  always on top) so it doesn't need renegotiating per phase.

## 3. Phased spec

### Phase 0 — bed-level canvas, in progress now

Scope: add/select/drag/resize rectangular beds, persisted via the real `Bed` CRUD API. No
rotation, no polygon, no plant placement, no domain-intelligence overlays.

- `frontend/src/pages/Layout.tsx`: replace the placeholder `Rect` with real data — `useQuery`
  against `listBeds()`, render one `Group` + `Rect` per bed (garden-space `pos_x`/`pos_y` as
  Group position, `width_cm`/`length_cm` scaled to px, color/fill keyed by `bed_type`).
- Select a bed → attach a Konva `Transformer` (single-select first; multi-select is cheap to add
  later given `Transformer` supports it natively, but not needed for phase 0).
- Drag → `dragBoundFunc` snapping to a small cm grid (e.g. 5 or 10cm — matches realistic planter
  placement precision); on `dragend`, `updateBed(id, { pos_x, pos_y })`.
- Resize via `Transformer` → on `transformend`, convert `scaleX`/`scaleY` back into
  `width_cm`/`length_cm`, reset scale to 1, `updateBed(id, { width_cm, length_cm })`.
- Add bed: a simple form/dialog (name, `bed_type`, dimensions) calling `createBed`, rather than
  click-drag-to-draw — matches the fact that this garden's beds are a small, known, physically
  fixed set (7 planters + berry row + 2 compost bins + 2 trees per root `CLAUDE.md`), not an
  open-ended drawing task. Click-to-draw can be reconsidered if manual coordinate/size entry turns
  out to be annoying in practice.
- Delete bed → `deleteBed`, behind a confirm (irreversible, and later phases will hang
  plantings/equipment off a bed — deleting one will eventually need to consider cascade behavior,
  not a phase-0 concern with `BedPlanting` not existing yet, but worth remembering once it does).
- Pan/zoom on the `Stage` for viewing the whole garden at once — the physical garden's total
  footprint (4×~1.4m² + 3×~0.2m² + berry row + 2 compost bins + 2 trees) is small enough this
  might not even be necessary at a reasonable canvas size; confirm empirically once real beds are
  on screen with `data/example_garden.json`'s bed layout before building pan/zoom speculatively.
- `data/example_garden.json`'s bed records (once `data-engineer` finishes it) are directly usable
  as manual/dev-console seed data for exercising this phase, even though there's no automated
  import script yet — that's fine for now, don't block phase 0 on the importer existing.

### Phase 1 — real bed geometry (rectangle rotation, then polygon)

Requires a `Bed` model change: add `orientation` (compass label) and either (a) add `rotation_deg`
as a new column alongside the existing flat fields, or (b) migrate to `docs/schema.md`'s
`border_geometry` jsonb approach wholesale. Recommend **(a) first** — add `rotation_deg` as an
independent float, keep `width_cm`/`length_cm`/`pos_x`/`pos_y` as-is — since every real bed in
this garden is a plain rectangle (per root `CLAUDE.md`'s garden description) and full polygon
support has no known use case yet (no oddly-shaped bed exists in the described garden). Full
`border_geometry` jsonb + polygon support is a bigger structural change (new Alembic migration,
data migration for existing rows, rewritten rendering logic) that should wait for an actual
polygon-shaped bed need to materialize, per `docs/schema.md`'s own "Modeling decisions worth
revisiting" note flagging this as unresolved — don't build polygon support speculatively.
- `orientation` unlocks the "north-facing edge" concept needed for phase 3's shade-casting logic.
- Requires an Alembic migration in the same commit as the model change (per root `CLAUDE.md`
  convention) and regenerating the typed frontend client (`npm run generate:api`).

### Phase 2 — plant placement within beds

Blocked on two things not yet built, both flagged already in `BACKLOG.md`:
1. `BedPlanting` model + API (point/line/polygon bed-local geometry, per `docs/schema.md`).
2. `Plant.growth_habit` wired from the data `data-engineer` is producing into an actual backend
   column + API field + frontend consumption (data-engineer's own scope explicitly stops at the
   JSON files — someone still has to build this).

Once both exist:
- Nest a `Group` per `BedPlanting` inside its bed's `Group`, in bed-local coordinates, per
  `docs/schema.md`'s coordinate-space design (already covered in section 1 above — this is
  exactly what that design was built for).
- Render each planting's shape from its `placement_type` (`individual` → circle sized to
  `spread_cm`, `row` → a line with tick marks at `row_spacing_cm` intervals, `field` → filled
  polygon) — this is the GrowVeg-style "icon sized to real mature footprint" pattern from section
  2, made concrete for this schema.
- Use `growth_habit` to pick an icon/shape family (vine, bush, upright, rosette, tree, ...) layered
  on top of the size-based footprint, once that field exists on `Plant`.
- A plant-picker UI (search/select from the existing `Plant` list — `listPlants()` already
  exists) to place a new planting.

### Phase 3 — domain intelligence overlays

All of these were called out as core domain notes in root `CLAUDE.md` but need data this editor
doesn't have until phases 1–2 land:
- **Succession/rotation family warnings** — needs `BedPlanting` history (which plant/family
  occupied a bed in prior seasons) plus `Plant.family` (already populated). Likely rendered as a
  bed border/fill color keyed by "was this family here last season" rather than a blocking
  validation — matches GrowVeg's rotation-mode coloring pattern from section 2.
- **Companion planting / bad-neighbor highlighting** — needs `BedPlanting` (adjacency within a
  bed) and existing `PlantCompanion` data (already populated by the ETL). A hover/select
  highlight mode (green good-neighbor / red bad-neighbor) is the well-trodden UX per section 2.
- **Shade-casting from neighbor height + orientation** — needs `Bed.orientation` (phase 1) and
  plant height (`Plant.height_cm`, already populated) to approximate which side of a bed falls in
  shadow. This is inherently approximate (no real sun-path simulation planned) — a coarse
  north/south relative-height heuristic is enough for this project's stated goal, not a full
  shadow-casting engine (see permaculture-tool comparison in section 2 — that level of fidelity
  is explicitly not warranted here).
- **Drip irrigation zone overlay** — needs `BedEquipment` (not yet built, separate backlog item)
  rendered as an additional toggle-able `Layer` (line geometry for drip runs, per
  `docs/schema.md`). Keep zone-only modeling for this pass; full pipe-network mapping is the
  explicitly-unresolved question from `docs/domain-model.md` and shouldn't be assumed as this
  editor's job to solve.

### Explicitly out of scope (not just "later" — genuinely not this editor's job)

- Full pipe-network mapping / valve-control input — open question in `docs/domain-model.md`,
  unresolved; if it's ever pursued it's a different kind of tool (topology graph, not a
  freeform canvas) layered on top of, not inside, this editor.
- A separate mobile/PWA layout view — root `CLAUDE.md` is explicit that mobile is a distinct,
  simplified route set (agenda/logging), not a responsive cut-down of the Konva editor. Don't
  spend phase 0 effort on small-screen responsiveness for this page.
- True sun-path/shadow simulation — see phase 3 note above; a coarse heuristic is the stated
  target, not a rendering-engine-grade simulation.
- Garden-plan/calendar-driven overlays (e.g. showing this year's `GARDEN_PLAN_ENTRY` assignments
  on the canvas) — depends on the not-yet-built `GARDEN_PLAN`/`ACTION` models; reasonable future
  phase 4 once those exist, not scoped here.

## 4. Design-for-later recommendations (to avoid a phase-1/2 rewrite)

- Model bed geometry internally in the frontend using a shape close to `docs/schema.md`'s
  `Geometry` discriminated union (`{ type: "rectangle", x, y, width, height, rotation }`) even in
  phase 0, translating to/from the flat `pos_x`/`pos_y`/`width_cm`/`length_cm`/(`rotation_deg`
  once it exists) API fields at the edges. Keeps the rendering/interaction code stable across the
  phase-1 model change instead of hardcoding flat-field assumptions throughout.
- Use a Konva `Group` per bed from day one (even though phase 0 has nothing to nest inside it
  yet) — this is free now and is exactly the structure phase 2's plant placements need to nest
  into, per the coordinate-space design already committed to in `docs/schema.md`.
- Centralize the cm→px scale factor and pan/zoom `Stage` state in one hook/context rather than
  local component state, since every future layer (plantings, equipment, overlays) needs to share
  the same coordinate transform.
- Decide the undo question deliberately rather than defaulting either way — the backlog doesn't
  currently commit to canvas undo, and section 2's research suggests it's meaningfully more work
  to build well (command-stack) than to fake cheaply (inverse-PATCH-of-last-mutation), with the
  cheap version not generalizing to phase 2/3. Worth a one-line decision from the human before
  phase 0 lands, not an assumption baked in silently.
- If a legend/color-key UI element is introduced for `bed_type` coloring in phase 0, keep it
  generic enough to extend for phase 3's family-rotation coloring and phase 2/3's equipment icons,
  rather than a bed-type-specific one-off.

## 5. Summary of concrete next actions (phase 0, mapped to real files)

- `frontend/src/pages/Layout.tsx` — swap placeholder for `useQuery(["beds"], listBeds)`-driven
  rendering.
- Reuse `frontend/src/api/client.ts`'s existing `listBeds`/`createBed`/`updateBed`/`deleteBed` —
  no backend or API-client change needed for phase 0.
- New: a small geometry/scale utility module (cm↔px, grid-snap function) shared by drag and
  resize handlers.
- New: bed selection + `Transformer` wiring, `onDragEnd`/`onTransformEnd` → `updateBed` mutations
  via `useMutation` (mirror `PlantsDatabase.tsx`'s existing mutation pattern).
- New: an add-bed form/dialog using shadcn/ui components (consistent with the rest of the app),
  not a canvas draw-to-create flow.
- Decide (human call, not this doc's to make): is canvas undo in scope for phase 0, and if so,
  cheap inverse-mutation stack or a real command-pattern history?
  **Decided 2026-07-19: no undo for phase 0.** Revisit once plant placement (phase 2) makes
  editing mistakes costlier than they are for bed-level drag/resize/add/delete alone.
