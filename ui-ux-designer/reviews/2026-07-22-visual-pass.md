# Visual-only screen review — 2026-07-22

**Scope:** a dedicated visual pass, distinct from today's earlier code-only
review (`ui-ux-designer/reviews/2026-07-22-review.md`, findings #141-149,
most already implemented and shipped by `frontend-developer` today). That
pass explicitly could not evaluate rendered pixels because Playwright wasn't
installed yet. It now is (owned by `tester`, installed in `frontend/`), so
this pass actually looks at the rendered app with real screenshots via
`npx playwright screenshot` against the deployed instance at
`http://192.168.0.26:8080` (real seeded data: 359 plants, a real 12-bed
example garden). Reviewed at `frontend/` HEAD `7c7848a3ec04cd7a832cfdf84a3c27bd4c4d8f6e`.

**Method:** `npx playwright screenshot <url> <output> [--viewport-size|--device]`
run from `frontend/` (no project file, no `frontend/e2e/` write — CLI only,
per this agent's hard filesystem boundary). Screenshots saved (gitignored)
under `ui-ux-designer/screenshots/`. Desktop captured at 1440×900; mobile
captured with Playwright's `"iPhone 13"` device emulation (390 CSS px wide)
so the mobile/PWA route set renders in a realistic mobile viewport rather
than a squished desktop layout. Every capture was then read and visually
inspected (not just structurally reasoned about).

**Routes covered** (from `frontend/src/components/nav/RootShell.tsx`, which
branches desktop vs. mobile by viewport width — 768px Tailwind `md`
breakpoint — rather than by URL prefix, so both route trees share the same
paths):

- Desktop (`AppShell`): `/` (Home), `/layout` (canvas editor, default
  "mine" mode / "Garden" tab), `/agenda`, `/seed-guide`, `/plants`,
  `/plants/beet` (a representative `/plants/:slug` detail page).
- Mobile (`MobileShell`): `/` (Home), `/agenda`, `/seed-guide`, `/logging`,
  `/notifications`.

**Known limitation of a static-screenshot pass:** the Layout canvas's other
tabs (Beds/Plants/Equipment), the "example garden" mode, the Dialog-based
forms (`AddBedForm`, `AddPlantForm`, `PlantPicker`), the toggle groups'
non-default states, and any hover-triggered tooltip content all require an
interaction the CLI screenshot tool can't script (click, then capture) —
per this task's own instructions, these are noted as unevaluated rather
than faked. Everything reported below is what a plain page load actually
renders.

---

## Findings

### 1. Layout canvas: bed/tree name labels overlap into illegible text when beds are adjacent — [#166](https://github.com/jochenderwae/GardenBedPlanner/issues/166)

The single clearest visual bug found this pass. On `/layout`'s default
"Garden" tab, with the real seeded garden (four large planters in a row,
three small planters in a row, two trees near each other — i.e. this app's
actual physical garden layout per root `CLAUDE.md`), every bed/tree's name
label draws unclamped from its top-left corner with no width limit,
truncation, or collision avoidance against the next bed's label. Adjacent
beds' labels render on top of each other:

- "Large Planter 1 (Greenhouse)" + "Large Planter 2" → illegible overlap.
- "Small Planter 1" + "Small Planter 2" + "Small Planter 3" (three narrow
  beds in a row) → collapses into one unreadable run.
- "Sour Cherry Tree" + the neighboring tree bed's label → same overlap.
- Labels also collide with the ruler's own `0m`/`1m`/`2m`... tick labels
  running along the same top edge.

This isn't an artifact of unusual test data — it's the direct, reproducible
consequence of placing multiple physically-adjacent beds, which is the
normal case for this app. See `screenshots/desktop-layout-garden-tab.png`
(the overlaps are visible around the four large planters near the top-left,
the three small planters mid-left, and the two trees near the bottom —
zoom in on that region to see the collision clearly; ad hoc zoomed crops
made during this review were discarded afterward since `screenshots/` is
gitignored/ephemeral).

Full design spec (Konva `Text` width-clamp + ellipsis, hover tooltip for
the untruncated name, vertical clearance from the ruler) is in the ticket
body. Filed `priority: high` — this is squarely editor work, and
product-owner's standing "editor-related work first" rule applies.

Separately noted but **not** ticketed: two beds in the current seed data
("Pear Patch" and a neighboring tree bed) visually/geometrically overlap
each other — their rectangles genuinely intersect. That reads as a data/
import issue (the interactive drag/resize path already enforces a
no-overlap constraint; this data got in without going through that path)
rather than a rendering defect, so it's flagged here for visibility but
left out of the label-overlap ticket's scope.

### 2. Plants Database filter dropdowns are unstyled native `<select>` elements — [#167](https://github.com/jochenderwae/GardenBedPlanner/issues/167)

On `/plants`, the "All families" and "All sun levels" filter controls
render with plain browser-default `<select>` chrome (system font, thin
native border/caret) — visibly different from the search `Input` and "Add
plant" `Button` sitting right next to them on the same toolbar row. The
inconsistency is easy to confirm because the *same conceptual field*
elsewhere in the app is already styled correctly: `/plants/beet`'s own
"Sun level" field (in the editable form) uses a properly-styled select
matching `Input`'s border-radius/color/focus ring. See
`screenshots/desktop-plants-database.png` and the crop
`_crop-sunlevel.png` showing the correctly-styled version for comparison.

Filed `priority: medium` (plant-database area, not editor-critical, but a
visible and easily-copied fix since the correct pattern already exists
elsewhere in this codebase).

### 3. Mobile bottom nav: "Notifications" label touches/overflows the screen edge on every mobile route — [#168](https://github.com/jochenderwae/GardenBedPlanner/issues/168)

`MobileShell.tsx`'s bottom nav uses five `flex-1` columns with zero
horizontal padding on the `nav` or each `NavLink`. At the iPhone 13's 390
CSS px width, each column is 78px wide; "Notifications" (the longest of
the five labels) is wider than that at `text-xs`, so its text overflows
its column — and since it's the rightmost item, that overflow runs
straight to the physical screen edge with zero margin. Reproduced
identically on all five mobile captures (`mobile-home.png`,
`mobile-agenda.png`, `mobile-seed-guide.png`, `mobile-logging.png`,
`mobile-notifications.png`) since `MobileShell` wraps the entire mobile
route set — most visible in `mobile-notifications.png` where that tab is
active/bold and its last glyph sits flush against the viewport boundary.
On a real notched/rounded-corner phone this has no safe-area clearance at
all.

Filed `priority: medium` — this is the mobile/PWA route set's only
navigation, so it touches every mobile screen, but it's a spacing/overflow
issue rather than something that blocks a task.

---

## Not flagged (checked, looked right)

- The default `/layout` "Edit garden" side panel (fields, tooltips,
  spacing) matches today's shipped shared-`Input`/tooltip work — clean,
  consistent field styling with info-icon tooltips on every field.
- Segmented-control toggle groups on the Layout toolbar (Edit/View,
  Garden/Beds/Plants/Equipment) render as a consistent black-pill-selected
  style, visually coherent with each other.
- `/plants/beet`'s form fields (today's shared `Input` + tooltip work) look
  visually correct and consistent field-to-field — labeled, bordered,
  spaced evenly, info icons aligned.
- `/agenda` (both desktop and mobile via the shared `AgendaView`) renders
  as clean grouped month cards with consistent spacing; no visual drift
  between the desktop and mobile renderings of the same shared component
  beyond the already-ticketed heading-size difference (#148).
- `/seed-guide`'s empty state (both desktop and mobile) is a clean,
  appropriately muted empty-state message — no layout issues.
- Icon-only bottom-nav items are appropriately sized/spaced vertically
  (`gap-0.5`, consistent icon size) — the horizontal-overflow bug above is
  specific to the widest label, not a systemic nav-bar problem.

## Not independently re-checked this pass

Home page's excessive vertical whitespace (`screenshots/desktop-home.png`,
`mobile-home.png`) is visually real but already covered by today's
code-only pass's #147 (`Home.tsx`'s `min-h-svh` conflicting with
`AppShell`'s own scroll-bounded layout) — not re-filed here.

---

## Tickets filed

All `-Origin agent` (starts at `status: new`, not self-released), all
`role:frontend-developer`.

| # | Finding | Area | Priority |
|---|---|---|---|
| [#166](https://github.com/jochenderwae/GardenBedPlanner/issues/166) | Layout canvas bed/tree label overlap | bed-crop-planning | high |
| [#167](https://github.com/jochenderwae/GardenBedPlanner/issues/167) | Plants Database native `<select>` styling | plant-database | medium |
| [#168](https://github.com/jochenderwae/GardenBedPlanner/issues/168) | Mobile bottom nav label edge overflow | seed-guide | medium |
