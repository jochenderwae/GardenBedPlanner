# WYSIWYG editor — lessons from other canvas/CAD-like tools

Deep-dive for the backlog item "WYSIWYG bed/layout canvas editor (`react-konva`)" in
`product-owner/BACKLOG.md`'s Bed & crop planning section. This is a **different angle** from
`product-owner/research/wysiwyg-bed-editor.md` (the original phased build spec, written before
rotation/polygon/ruler/tabs existed): that doc plans *this app's* features from the domain model
outward; this one mines *other* drawing tools for concrete interaction patterns and cross-checks
them against the real gaps in the code as it stands today. Where the two overlap (e.g. both
mention undo, pan/zoom) this doc supersedes the older one's treatment of those specific points —
it's written against the actual current code, not a pre-build guess.

## 0. Verified current state (this run, read directly from `frontend/src/pages/layout/`)

- `geometry.ts`: fixed `CM_TO_PX = 1`, fixed `CANVAS_WIDTH_PX = 1400` / `CANVAS_HEIGHT_PX = 900`,
  no zoom/scale state anywhere. `snapToGrid(value, gridSizeCm = 10)` is a pure function, used only
  in `BedNode.tsx`'s rectangle `dragBoundFunc` — **not** used by `Transformer` resize, not used by
  `PolygonEditor`'s vertex/shape drag, not used by `PlantPlacementLayer`'s planting drag. So even
  the one snap behavior that exists today is inconsistently applied.
- `BedNode.tsx`: rectangle drag snaps to a fixed 10cm grid via `dragBoundFunc`; resize/rotate go
  through Konva's `Transformer` with no grid snap at all (`onTransformEnd` just rounds
  width/height to whole cm, not to the 10cm grid) and no live dimension readout during the drag —
  the new size is only visible once you release and the `BedPanel` form field updates.
- `PolygonEditor.tsx`: whole-shape drag and per-vertex drag have **no snapping at all** — free
  pixel-precision dragging, no grid, no edge/vertex alignment to other shapes.
- `PlantPlacementLayer.tsx`: planting markers drag with no snapping either.
- No `Stage` `draggable`, no wheel handler, no scale state — confirmed no pan/zoom exists anywhere
  in `Layout.tsx` or any `layout/*.tsx` file (`Grep` for `wheel|scale` only matched the geometry
  math already listed above).
- No keyboard event handling anywhere in `frontend/src/pages/layout/` (`Grep` for
  `onKeyDown|useHotkeys` returned zero matches).
- No multi-select: `Transformer.nodes([...])` is only ever called with a single node
  (`BedNode.tsx`'s `useEffect`).
- No undo/redo, no copy/paste, anywhere.
- **No frontend test runner exists at all** — `frontend/package.json` has no `vitest`/`jest`/
  `@testing-library/*` dependency and no test script. This matters directly for this doc's plan:
  several of the recommendations below are deliberately scoped as pure, unit-testable functions
  *because* there's no browser-automation tool in this environment to verify interactions
  visually — but that only pays off once there's a way to actually run those unit tests. Treat
  "add a minimal Vitest setup" as a near-zero-cost prerequisite, not a separate large task (Vite
  projects wire up Vitest with one dependency and a few lines of config; no new build tooling
  needed since Vite already owns the toolchain).
- Confirmed in passing (not this doc's main focus, but worth a one-line correction while reading
  the file it touches): `frontend/vite.config.ts` **does** already configure `VitePWA` (manifest
  with name/theme/icons array present but empty, `registerType: "autoUpdate"`) — the existing
  BACKLOG.md line saying "no `vite-plugin-pwa` config found" is stale as of this run. It's a bare
  manifest registration only — no push-notification wiring, no offline-caching strategy configured
  beyond the plugin's defaults — so the backlog item isn't fully done, just further along than
  currently recorded. Corrected in the backlog update below.

## 1. Lessons from comparable tools

### tldraw (infinite-canvas SDK, the closest architectural cousin to a Konva-based editor)

- **Snap threshold is a fixed *screen*-pixel value (8px), scaled by zoom**, not a fixed
  world-space distance. At 200% zoom that's 4 canvas units; at 50% zoom, 16. This is the right
  model for this app too once zoom exists: a `DRAG_SNAP_CM` constant makes sense at the current
  fixed 1cm=1px scale, but once zoom is added, snapping needs to be computed in screen pixels and
  converted, or a 10cm grid snap becomes either useless (zoomed out, 10cm is sub-pixel) or
  obstructive (zoomed in, 10cm feels huge) depending on zoom level.
- **Snap targets are the other shapes' bounding-box edges/centers, not just a fixed grid** —
  corner handles snap both axes, edge handles snap only the perpendicular axis. Directly
  applicable: a bed being dragged should be able to snap to align with another bed's edge, not
  just to the nearest 10cm grid line. This is the single most valuable interaction pattern for
  this specific app, given the real garden has planters that sit in actual rows (the berry row,
  the 4 large planters) where edge-alignment matters more than absolute-grid-position precision.
- **Snap indicators are transient, non-persisted lines drawn only during the active drag**, cleared
  on drag end — this is a rendering-only concern, doesn't touch the data model at all. Cheap to
  add without disturbing anything already built.
- Undo/redo and resize/rotate/translate all go through a shared, centralized interaction/command
  layer rather than being reimplemented per shape type — worth noting as a caution, not a
  requirement: this app's much smaller surface (beds, garden boundary, plantings, equipment — four
  entity types, not an open shape palette) doesn't need tldraw's generality, but *if* undo is
  built, funnel every geometry mutation (`handleBedChange`, `handleGardenGeometryChange`,
  `handlePlantingMove`, and the equivalent for equipment once it gains drag) through one small
  shared "commit a geometry change" function so a single undo stack can sit behind all of them,
  rather than four independent one-off histories.

### Excalidraw (simpler canvas tool, closer in scale to what this app actually needs)

- **Grid snap and object snap are two independent, both-optional systems** (grid: fixed spacing;
  object: align to other shapes' edges/midpoints/equal-gaps), toggled separately (`Alt+S` for
  object snap). Confirms the tldraw lesson above is a distinct feature from grid snap, not a
  replacement for it — this app should plan to keep its existing grid snap *and* add object-edge
  snap as a second, independent check, not pick one.
- **Align/distribute as an explicit menu action on a multi-selection** (align left/right/top/
  bottom/center, distribute evenly), rather than only interactive drag-snapping. Lower priority
  here — this garden's beds are a small, mostly-fixed physical set (per root `CLAUDE.md`: 4 large
  planters, 3 small planters, a berry row, 2 compost bins, 2 trees), not dozens of objects needing
  bulk alignment — but worth keeping in mind if multi-select is ever built, since it's a small
  incremental add once multi-select and snapping both exist.

### Figma (mature reference for pan/zoom/keyboard/multi-select conventions)

- **Zoom**: `Ctrl/Cmd + scroll` to zoom (not scroll-to-zoom by default, since plain scroll usually
  means pan), `Ctrl/Cmd + +/-` for stepped zoom, `Shift+1` = zoom-to-fit-all, `Shift+2` =
  zoom-to-fit-selection, `Shift+0` = 100%. **Pan**: hold `Space` to get a temporary hand/pan
  cursor while any tool is active, or a dedicated pan tool. This is the standard, well-understood
  convention worth matching rather than inventing a bespoke scheme — familiarity costs nothing and
  a "zoom to fit the whole garden" action is a genuinely useful default view given this app's
  garden has both large planters and small ones on the same canvas.
- **Multi-select**: click-drag on empty canvas = marquee/rubber-band select of everything the
  rectangle intersects; `Shift/Cmd+click` toggles individual items in/out of the selection.
  `Transformer` in Konva already supports being handed an array of nodes natively (confirmed in
  the earlier research doc's section 2 and still true) — the missing piece here is purely the
  marquee-rect intersection-test logic and the click-modifier wiring, not a Konva capability gap.
- **Keyboard nudge**: arrow keys move the selection by 1 unit, `Shift+arrow` by a larger step —
  this app's equivalent "1 unit" is naturally `DRAG_SNAP_CM` (already a named constant), so nudge
  is nearly free to add once a selected-object concept and keyboard listener both exist.
- **Delete**: `Delete`/`Backspace` on a selection — this app already has delete via double-click
  (plantings) and a panel button with a confirm dialog (beds), but no keyboard equivalent.

### RoomSketcher / Floorplanner (floorplan tools — closest domain analog: real-world-scale
furniture-like objects placed inside room/plot boundaries, exactly this app's bed/equipment/
planting relationship)

- **Furniture snaps to the nearest wall or other furniture automatically when dragged close**, with
  a modifier key (`Ctrl`/`Cmd`) to temporarily *suppress* snapping rather than the reverse (default
  is snap-on). Directly analogous to plantings/equipment snapping to a bed's edge or to each other
  — this app's `PlantPlacementLayer` and equipment placement currently have zero snapping, and this
  is the most on-point precedent: a planting or an equipment item (e.g. a drip line, a trellis)
  dragged near a bed edge should snap to it the same way furniture snaps to a wall.
- **Live measurements while drawing/resizing walls** — the size readout updates continuously during
  the drag, not just on release. Confirms the live-dimension-label gap flagged in this app's own
  known-gaps list is a real, well-precedented UX expectation for a scale-accurate tool, not
  something only "nice to have" — floorplan tools treat it as baseline.
- **Explicit real-world unit handling with a settable scale** — this app already has this mostly
  solved (`CM_TO_PX`, `formatDistanceCm`, metric-only by design with an explicit note that imperial
  is a later, isolated change) — no new lesson here beyond confirming the existing approach (fixed
  scale factor, single formatting chokepoint) is the right shape, not something to redesign.
- **Floorplanner's own noted weakness** (object controls not consistently visible, no snap-to-fit,
  slow 2D/3D toggle as projects grow) is a useful negative example: it shows what happens when an
  editor's affordances (resize handles, snap feedback) aren't consistently present across every
  object type. This app already has a milder version of that same inconsistency today — rectangle
  beds get `Transformer` handles and snap-on-drag, polygon beds and plantings get neither. Worth
  fixing for consistency's own sake before adding more features on top of an uneven foundation.

### Dedicated online garden planners (GrowVeg, gardenplanner.net, VegPlotter, Hortisketch, and
similar — confirmed still exist and match the profile described in the earlier research doc's
"general knowledge" section, now grounded with live search)

- Confirms the earlier doc's characterization: these tools center on a **drag-and-drop plant icon
  palette sized to real mature footprint**, metric/imperial toggle, snapping, and printable/
  exportable output (PNG/PDF/SVG) — not deep CAD precision tooling. Reinforces that this app's
  planned direction (rectangle-first beds, real-size plant footprints via the in-progress
  `growth_habit` field, family-based rotation coloring) is squarely the right reference class, not
  under- or over-ambitious for the domain.
- None of the general-purpose ones found in this pass do free-form polygon *bed* editing either —
  same conclusion as the earlier doc: this app has already gone a bit further than most direct
  comparables by supporting polygon beds at all (reasonable, since this garden's actual boundary
  and a couple of planters may not be perfectly rectangular) but that's this app's own choice to
  support, not something borrowed from a comparable tool's precedent.

## 2. Gap analysis — what to actually build here

| Gap | Precedent | Verdict |
|---|---|---|
| No pan/zoom | Figma, tldraw, every floorplan tool | **Build** — foundational; also makes the fixed-1cm=1px scale problem (a large garden won't fit 1400×900px) actually solvable instead of hoped-around. |
| No live dimension label during drag/resize | RoomSketcher | **Build** — cheap, high value, directly precedented by the domain-closest comparable (floorplan tools treat it as baseline, not extra). |
| No object-edge/alignment snapping (beds-to-beds, plantings/equipment-to-bed-edge) | tldraw, Excalidraw, RoomSketcher | **Build** — the highest-value *new* interaction, and the one with the most direct domain precedent (RoomSketcher's furniture-to-wall snap is this app's planting/equipment-to-bed-edge case almost exactly). |
| Grid snap inconsistently applied (rectangle drag only, not resize/rotate/polygon/plantings) | Excalidraw (grid snap as one clean, universally-applied system) | **Fix** — this is a correctness/consistency issue in what's already built, not a new feature; cheap, do it alongside the alignment-snap work since both touch the same drag-handling code paths. |
| No keyboard shortcuts (nudge, delete, escape-to-deselect, zoom-to-fit) | Figma | **Build a small, targeted subset** — nudge and delete are near-free once a selection concept exists; full Figma-parity shortcut coverage is not warranted for a single-user tool with four entity types, not an open design surface. |
| No undo/redo | tldraw (command layer), earlier research doc's own analysis | **Build, but keep scope small** — a linear stack of inverse-PATCH mutations (the earlier doc's "cheap" option) is now more clearly justified than it was when that doc was written, precisely *because* alignment-snapping and multi-drag make mistakes easier to make accidentally than plain single-axis grid-snapped dragging was. Still not a full tldraw-style command-pattern engine — see phased plan below for why a small scoped version is enough here. |
| No multi-select / marquee select | Figma, Excalidraw | **Build, lower priority** — genuinely useful for plantings (bulk-move or bulk-delete a whole row of one crop) more than for beds (a small, mostly-fixed physical set per root `CLAUDE.md` — bulk bed operations aren't a real workflow). Scope multi-select to the Plants tab first if built at all. |
| No copy/paste | Figma, Excalidraw | **Skip for beds, maybe for plantings.** Beds are a fixed physical inventory (7 planters + berry row + 2 bins + 2 trees) — duplicating one isn't a real workflow. A planting is different (sowing the same crop in 5 spots is common) — "duplicate this planting" is a real, if minor, convenience. Not urgent; only worth it once multi-select exists to make it more than a one-off action. |
| Align/distribute menu action | Excalidraw | **Skip** — needs multi-select first, and this garden's small object count doesn't create the "many objects to tidy up" problem this feature solves for. |
| 2D/3D toggle, realistic rendering, printable export | RoomSketcher/Floorplanner/garden planners | **Skip** — explicitly out of scope; this is a planning tool for a fixed physical garden, not a presentation/visualization tool, and root `CLAUDE.md` doesn't call for photorealistic or exportable output anywhere. |

## 3. Phased plan

Ordered by (a) foundational-first — pan/zoom changes the coordinate math everything else builds
on, so it goes first — then (b) cheapest-and-highest-value, then (c) scope-risk (undo and
multi-select are the two most open-ended asks, saved for last and deliberately scoped down).

Every phase below is written to be checkable via code review, `npm run build`/`tsc`, `npm run
lint`, and (once the Vitest prerequisite lands) unit tests of the extracted pure functions — not
via live browser interaction, since no browser-automation tool is available in this environment.
Where a phase has an interactive-feel component that can't be verified that way, it's called out
explicitly so a human knows what still needs eyes-on confirmation before considering it done.

### Phase 0 — prerequisite: minimal Vitest setup

Not really part of the editor at all, but every phase below leans on "pure function, unit
tested" as its verification strategy, and that strategy doesn't work without a test runner.
- Add `vitest` as a devDependency, a one-line `test` script, and (if needed) a trivial
  `vitest.config.ts` reusing the existing `vite.config.ts` resolve aliases (`@/` → `src/`).
- No component/DOM testing needed yet (no `@testing-library/react`, no `jsdom`) — everything this
  plan wants tested is plain TypeScript logic (`geometry.ts`-style pure functions), so a bare
  Node-environment Vitest config is enough for now. Add `jsdom`/React Testing Library later only
  if a future task genuinely needs it.
- A `claudeTools/frontend_test.ps1` wrapper (mirroring `frontend_build.ps1`/`frontend_lint.ps1`)
  belongs alongside this, per the project's own convention of wrapping every repeatable command.

### Phase 1 — pan/zoom

- New `layout/viewport.ts`: pure functions `screenToWorld(point, viewport)` /
  `worldToScreen(point, viewport)` / `clampScale(scale, min, max)`, where `viewport = { x, y,
  scale }` (Konva `Stage` position/scale). These are directly unit-testable (feed in known
  points, assert round-trip and clamping behavior) without touching Konva at all.
- Wheel-to-zoom on the `Stage`, following the Konva docs' pointer-relative pattern (capture world
  point under pointer before rescale, recompute stage position after rescale so that point stays
  fixed) — `Ctrl/Cmd+scroll` for zoom, plain scroll for pan (matches Figma's convention and avoids
  the common gotcha of plain-scroll-zoom fighting with page/panel scroll).
  `viewport.ts`'s pure math is what's testable here; the actual wheel-event wiring in `Layout.tsx`
  is thin glue and doesn't need its own tests.
- `Space`-hold for temporary pan cursor (or a simpler always-available middle-mouse-drag-to-pan,
  which needs no modal state at all — worth considering as the lower-complexity option given no
  visual QA is available to confirm a cursor-swap "feels right").
  # PLANTS_LEFT_INTENTIONALLY: decide between Space-hold and middle-drag during implementation —
  either is fine, middle-drag is less code and doesn't need a keydown/keyup pair.
- A "fit to garden" button/keyboard shortcut (compute the bounding box of the garden boundary + all
  beds, set `viewport` to fit it in the visible canvas with margin) — replaces the current
  fixed-1400×900 "hope it's big enough" approach with an actual answer to "does everything fit,"
  and is itself a pure, testable function (`fitViewport(boundingBoxes, canvasSize) -> viewport`).
- `RulerLayer` needs to read from `viewport.scale` instead of assuming 1cm=1px — tick spacing in
  screen-px should adapt (e.g. switch from 1m to 10cm or 5m ticks depending on zoom) the same way
  most CAD/floorplan rulers do; `formatDistanceCm` already isolates the label formatting, so this
  is mostly about picking tick spacing, another pure/testable function.
- Existing `GridLines`, `BedNode`, `PolygonEditor`, `PlantPlacementLayer`, `EquipmentLayer` all
  currently assume canvas-px == cm; once a `Stage` scale/position exists this mostly falls out for
  free (Konva shapes stay in world/cm coordinates, the `Stage` transform handles screen mapping) —
  but `dragBoundFunc`'s snap-to-grid math and any screen-space thresholds (see phase 3) need to
  explicitly account for scale, per the tldraw lesson above (screen-px thresholds, not fixed
  world-space ones).

### Phase 2 — live dimension labels during drag/resize

- Rectangle beds (`BedNode.tsx`): during `onDragMove`/on the `Transformer`'s live transform (not
  just `onTransformEnd`), render a small `Text` node (imperative Konva update via ref + own
  `layer.batchDraw()`, same pattern `PolygonEditor.tsx`'s `handleVertexDragMove` already uses for
  live vertex-position feedback — this app already has the exact right pattern in the codebase,
  it's just not applied to `BedNode`) showing current width/height (drag) or new width × height
  (resize), formatted via the existing `formatDistanceCm`.
- Polygon beds/garden boundary: show the moving vertex's distance to its two neighbors during a
  vertex drag (simpler than a full running-area readout — matches this doc's earlier note that
  precise per-edge polygon dimensioning is a nice-to-have, not baseline, for now).
- This phase touches only rendering during an in-progress gesture, not the committed data model —
  low risk, and the underlying formatting/geometry math (`boundingRect`, `formatDistanceCm`,
  distance-between-two-points) is already pure and already covered by phase 0's testing setup once
  it's used in one more place.

### Phase 3 — snapping consistency fix + object-edge alignment snap

- First, fix the existing inconsistency (table row above): make `snapToGrid` apply uniformly to
  rectangle resize (currently only rounds to whole cm) and to `PolygonEditor`'s vertex/shape drag
  and `PlantPlacementLayer`'s planting drag (currently no snap at all). One shared
  `snapPointToGrid(point, gridSizeCm)` helper used everywhere a drag commits a position, rather
  than the current one-off application in a single `dragBoundFunc`.
- Then add the new capability: a pure `findAlignmentSnap(movingBox, candidateBoxes, thresholdPx,
  scale) -> { x?: number, y?: number, guides: Guide[] }` function (candidate edges = other beds'
  bounding-box edges/centers for bed dragging; a bed's own edges for plantings/equipment dragging
  inside it — directly matching the RoomSketcher furniture-to-wall precedent). This is the single
  most valuable and most directly-precedented new interaction from the research above. Threshold
  is in *screen* pixels scaled by `viewport.scale`, per the tldraw lesson — this only makes sense
  to build after phase 1 lands zoom, since a fixed-cm threshold degrades exactly the way tldraw's
  design note warns about.
- Render transient alignment-guide lines only while a drag is active (own `Layer`, cleared on drag
  end) — purely additive rendering, doesn't touch the persisted geometry.
- `Ctrl/Cmd`-held-while-dragging suppresses both grid and alignment snap for the rare case a user
  wants to place something off-grid deliberately (RoomSketcher's convention — default on, hold to
  suppress, rather than the reverse).
- The snap-target-selection and distance-threshold math (`findAlignmentSnap` itself) is fully pure
  and unit-testable with synthetic box coordinates — no Konva or DOM needed. The actual guide-line
  rendering and modifier-key wiring is thin glue that can't be meaningfully unit-tested and would
  need a human to eyeball once built.

### Phase 4 — keyboard shortcuts: nudge, delete, escape

- A single keyboard listener at the `Layout.tsx` level (or a small `useLayoutKeyboardShortcuts`
  hook) active only while something is selected (a bed, a garden boundary, a planting — whatever
  concept of "selected" already exists per tab) and the relevant tab is active — reuses the
  existing tab-gated "interactive" mechanism already in place, doesn't need a new locking concept.
- Arrow keys → nudge selected object by `DRAG_SNAP_CM` (Shift+arrow → 5× that, matching Figma's
  small/large-step convention) — commits the same `handleBedChange`/`handlePlantingMove` mutation
  path already used by drag-end, just with a computed delta instead of a pointer position.
- `Delete`/`Backspace` → same delete action already reachable via the existing UI per object type
  (bed: same confirm-guarded delete as the panel button; planting: same as double-click).
- `Escape` → clear selection (`setSelectedId(null)`/`setGardenPanelOpen(false)`/close picker) —
  currently only reachable by clicking empty canvas.
- The nudge delta computation is a trivial pure function worth its own unit test (given a
  direction and modifier state, returns the right delta); the event-listener wiring and its
  interaction with existing click-to-select/tab-switch logic needs a human to confirm no keyboard
  shortcut leaks across tabs or interferes with typing in the `BedPanel`/`GardenPanel` forms
  (a well-known keyboard-shortcut-tool gotcha: listeners on `document` firing while an `<input>`
  has focus — guard on `e.target` not being a form element, or scope the listener to the `Stage`'s
  container rather than `document`).

### Phase 5 — undo/redo (scoped small, per the gap-analysis verdict above)

- A single, small `useGeometryHistory` hook (or equivalent) wrapping the four existing geometry
  mutation call sites (`handleBedChange`, `handleGardenGeometryChange`, `handlePlantingMove`, and
  equipment's equivalent once/if it gains drag) — each push records `{ entityType, id,
  before: Geometry, after: Geometry }`. `Ctrl/Cmd+Z` pops the stack and re-issues the inverse PATCH
  (`before`); `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`) redoes from a second stack.
- Deliberately **not** a full command-pattern engine covering every mutation type (add/delete bed,
  add/delete planting, non-geometry field edits) — scoped to geometry moves/resizes only, which is
  where the new snapping/multi-select work in phases 1-4 makes accidental mistakes meaningfully
  easier to make than they were with the old single-axis-grid-only interaction. Add/delete undo
  can be a later, separate extension of the same stack shape (`{ type: 'delete', entity, snapshot
  }` alongside the geometry-move entries) if it turns out to be wanted — don't build it
  speculatively now.
- History stack push/pop logic itself is pure and unit-testable (given a sequence of pushes and
  undo/redo calls, assert the stack state and what the "current" value would be) independent of
  the actual PATCH network calls, which can be mocked/stubbed in the same test.
- Explicitly **not** persisted across page reloads (in-memory only) — matches this app's small,
  single-session editing pattern; no evidence a cross-session undo is a real need here.

### Phase 6 — multi-select (Plants tab first)

- Marquee select: click-drag on empty canvas within the active layer computes intersection between
  the drag rectangle and each candidate object's bounding box (`boundingRect` already exists) —
  another pure, testable function (`itemsInMarquee(marqueeRect, items) -> selectedIds`).
- `Shift/Cmd+click` toggles individual items in/out — standard, matches Figma/Excalidraw.
- Bulk actions once multi-select exists: bulk delete (multiple plantings at once — e.g. clearing a
  whole finished row) is the clear first payoff; bulk drag (move a whole row together) is a
  reasonable second step reusing `Transformer`'s native multi-node support.
- Scoped to the Plants tab first per the gap-analysis verdict (plantings are numerous enough to
  benefit; beds are a small fixed set that doesn't have the same bulk-operation need) — extending
  to beds/equipment later is a small increment if it turns out to be wanted, not a rearchitecture.
- Copy/paste for plantings ("duplicate this planting" — sow the same crop in another spot) becomes
  a natural, cheap addition once this phase's selection model exists; not worth building in
  isolation before it (per the gap-analysis verdict above).

### Explicitly out of scope (not phased in at all — different verdict, not just "later")

- 2D/3D toggle, photorealistic rendering, printable/exportable output (PNG/PDF/SVG) — this is a
  planning tool for a fixed physical garden, not a presentation tool; no comparable feature is
  called for anywhere in root `CLAUDE.md` or `docs/domain-model.md`.
- Align/distribute menu commands — needs multi-select and doesn't solve a real problem at this
  garden's object count (small, mostly-fixed physical inventory per root `CLAUDE.md`).
- Full command-pattern undo covering every mutation type — see phase 5's scoping rationale.
- Mobile/touch-specific gesture support (pinch-zoom, two-finger pan) for this canvas — root
  `CLAUDE.md` is explicit the desktop canvas editor and the mobile/PWA route set are meant to stay
  separate; don't spend effort making the Konva editor touch-friendly.
- Imperial units — already correctly deferred by the existing `formatDistanceCm` design (isolated
  chokepoint, not yet built) per the earlier research doc; nothing here changes that.

## 4. Summary of concrete next actions, mapped to files

- `frontend/package.json` / new `vitest.config.ts` / new `claudeTools/frontend_test.ps1` — phase 0
  prerequisite.
- New `frontend/src/pages/layout/viewport.ts` — pure screen↔world/clamp/fit functions (phase 1).
- `frontend/src/pages/Layout.tsx` — `Stage` wheel handler + pan, "fit to garden" action (phase 1).
- `frontend/src/pages/layout/RulerLayer.tsx` — scale-aware tick spacing (phase 1).
- `frontend/src/pages/layout/BedNode.tsx` — live dimension `Text` during drag/transform (phase 2);
  route resize through the shared grid-snap helper (phase 3 consistency fix).
- `frontend/src/pages/layout/PolygonEditor.tsx` — apply grid snap to vertex/shape drag (phase 3
  consistency fix).
- `frontend/src/pages/layout/PlantPlacementLayer.tsx` — apply grid snap to planting drag (phase 3
  consistency fix).
- New `frontend/src/pages/layout/alignmentSnap.ts` — `findAlignmentSnap` pure function + a
  transient guide-line rendering layer wired into `BedNode`/`PolygonEditor`/
  `PlantPlacementLayer`'s drag handlers (phase 3 new capability).
- New keyboard-shortcut hook (`frontend/src/pages/layout/useLayoutKeyboardShortcuts.ts` or similar)
  wired into `Layout.tsx` (phase 4).
- New `frontend/src/pages/layout/useGeometryHistory.ts` wired into `Layout.tsx`'s four geometry
  mutation handlers (phase 5).
- New `frontend/src/pages/layout/marquee.ts` (`itemsInMarquee`) + selection-state changes in
  `Layout.tsx`/`PlantPlacementLayer.tsx` (phase 6).
