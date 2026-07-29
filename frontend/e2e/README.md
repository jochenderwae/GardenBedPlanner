# e2e

Playwright end-to-end specs, run headless via `npm run test:e2e` (see `frontend/playwright.config.ts`). Owned by the `tester` agent (`.claude/agents/tester.md`) - it writes real specs here per backlog ticket, covering interactive/browser flows that a Vitest unit test can't (drag-and-drop on the canvas editor, multi-step forms, navigation).

## Running against a real backend

These specs drive a real browser against the local dev server (`npm run dev`,
started automatically by `playwright.config.ts`'s `webServer` block) which
proxies `/api` to whatever backend is running on `:8000` - so a backend also
has to be running, **with `DATABASE_URL` pointed at `TEST_DATABASE_URL`'s
value** (garden_test), never the real `garden` database:

```powershell
cd backend
$env:DATABASE_URL = "<TEST_DATABASE_URL value from backend/.env>"
uv run uvicorn app.main:app --port 8000
```

Specs seed/clean up their own data directly via the API (`request` fixture)
- they don't depend on or mutate any pre-existing garden_test state, and
  leave none behind on success. `garden_test` is freely truncatable if a
  run is interrupted mid-test and leaves stray `E2E ...`-named beds behind
  (see `.claude/skills/db-query`).

  Note (#211, 2026-07-29): `DELETE /api/beds/{id}` (no `cascade`) cleanly
  409s - never 500s - whenever an Action row references the bed, which every
  bed created via the API gets for free (`generate_bed_tasks` on create;
  #210 re-verified the 409-not-500 behavior directly against real
  `garden_test` and closed with a regression test, no code change needed). A
  spec whose cleanup just does `request.delete(...).catch(() => {})` with no
  `cascade=true` silently swallows that 409 and leaves the bed behind,
  polluting later runs/tests sharing `garden_test` - #211 swept every
  `finally`/`afterEach` cleanup delete under `frontend/e2e/` to pass
  `?cascade=true` for exactly this reason. Copy that pattern (plain
  `?cascade=true` on the cleanup delete is enough now - no need for
  `bed-canvas-drag-pan.spec.ts`'s older manual "delete the bed's Action rows
  first" workaround, which still works but is redundant) in any new
  bed-creating spec.

## Specs

- `bed-canvas-drag-pan.spec.ts` - #14, canvas drag/pan/marquee-select
  interaction regression coverage.
