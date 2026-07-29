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

  Note (#14 re-verification, 2026-07-29): `DELETE /api/beds/{id}` still 500s
  (#210, open) whenever an Action row references the bed - which every bed
  created via the API gets for free (`generate_bed_tasks` on create). A spec
  whose cleanup just does `request.delete(...).catch(() => {})` will silently
  leave every bed behind once #210's FK violation starts firing, polluting
  later runs/tests sharing `garden_test`. `bed-canvas-drag-pan.spec.ts`'s
  `afterEach` deletes each bed's dependent Action rows first as a workaround;
  copy that pattern in any new bed-creating spec until #210 actually ships.

## Specs

- `bed-canvas-drag-pan.spec.ts` - #14, canvas drag/pan/marquee-select
  interaction regression coverage.
