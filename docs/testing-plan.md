# Test-framework plan

Phased plan for adding real test coverage across all three areas of the monorepo (`backend/`, `frontend/`, `data/`). Written 2026-07-19 by a planning pass (not yet implemented) - see `.claude/skills/test-backend/`, `test-frontend/`, `test-data/` for the skills this plan is meant to update once each phase lands.

## Ground truth confirmed before planning

- No `.github/workflows/` exists anywhere in the repo — there is genuinely no CI. This plan targets local/agent-invoked runs via the `.claude/skills/*/scripts/*.ps1` PowerShell scripts + skills, structured so a CI workflow could wrap the same commands later without rework.
- Backend: `pytest>=9.1.1`, `httpx` already dev deps in `backend/pyproject.toml`; one trivial test (`test_health.py`); `get_session()` (`app/core/db.py`) is a plain generator dependency reading `settings.database_url` — the natural FastAPI override point.
- `app/api/deps.py`'s `commit_or_409` calls `session.commit()` inside route handlers — this matters directly for isolation-strategy choice (below): any rollback-based isolation must survive the app calling `commit()` itself, not just test code.
- Frontend: zero test deps, Vite 8, React 19, `react-konva` 19.2, `@base-ui/react` 1.6, TanStack Query 5. No component currently separates Konva rendering from pure math except `geometry.ts`, which is already fully Konva-free and directly unit-testable.
- Data: zero test deps, only `ruff`. `data/.cache/` (real API response shapes) is `.gitignore`d, so tests must use committed, trimmed copies of real shapes under `data/tests/fixtures/`, not read `.cache/` live (non-reproducible on a fresh checkout, and drifts with whatever the last ETL run happened to cache).
- `data/etl/ollama_resolve.py`'s `_call_ollama` is the sole Ollama touchpoint (`httpx.post` to `settings.ollama_host`), a single clean seam to mock.

## Phase 1 — Scaffolding (all three areas, parallelizable)

### Backend

- No new prod deps needed. Dev deps: `pytest` + stdlib `sqlalchemy`/`alembic` (already transitive via `sqlmodel`/`alembic`) suffice for the fixture pattern below.
- New env var `TEST_DATABASE_URL` — document in `.env.example` and root `CLAUDE.md`'s Commands section. Points at a **separate database** on the new test Postgres account (e.g. `garden_test`), never the app's real `garden` database.
- `backend/pyproject.toml`: register a `pytest.ini_options` marker:
  ```toml
  [tool.pytest.ini_options]
  markers = ["integration: needs a real Postgres via TEST_DATABASE_URL"]
  ```
- `backend/tests/conftest.py`:
  - Session-scoped `engine` fixture from `TEST_DATABASE_URL`. If unset, integration tests `pytest.skip(...)` explicitly rather than silently no-op-ing — never report false success.
  - Session-scoped fixture applying migrations once per run via Alembic's Python API (`alembic.command.upgrade`), not shelled out.
  - Function-scoped `db_session` fixture: opens a connection, yields a `Session`, and on teardown **truncates every app table** (`TRUNCATE ... RESTART IDENTITY CASCADE`).
  - Function-scoped `client` fixture: overrides `get_session` via FastAPI's `app.dependency_overrides`, wraps in `TestClient`.

**Isolation strategy — recommendation: truncate-between-tests, not transaction-rollback.**

| Strategy | Speed | Isolation | Fit here |
|---|---|---|---|
| Transaction-per-test rollback (savepoint) | Fastest | Perfect | Needs special `Session` config (`join_transaction_mode="create_savepoint")` to survive the app's own `commit_or_409()` calls — real maintenance cost. |
| **Truncate all tables after each test** | Slightly slower | Perfect | **Recommended.** Works transparently with the app's own `commit()` calls, trivial fixture. At ~10 tables over a LAN/VPN connection, not meaningfully slower. |
| Schema wiped + fresh `alembic upgrade head` per run | Slowest | Perfect + exercises migrations | Reserve for an occasional/manual migration-integrity check, not every-test overhead. |

**Highest-value first tests** (the Garden/Bed/Planting/BedEquipment surface built in the redesign session has zero coverage today - start there):

1. `test_bed_crud.py` — full CRUD round trip + 404 + rectangle↔polygon `border_geometry` round-trips.
2. `test_garden.py` — `GET /api/garden` 404-before-first-`PUT` contract, `PUT` create/update.
3. `test_planting_crud.py` — bad FK → asserts **409** via `commit_or_409`, not a raw 500.
4. `test_bed_equipment_crud.py` — nullable `bed_id`/`geometry` (inventory case).
5. `test_migrations.py::test_upgrade_head_is_clean` (marked slow/manual) — real fresh-schema migration run.

### Frontend

- **Vitest** (not Jest) — reuses Vite's own config/transform pipeline, no duplicate module resolution to keep in sync.
- New dev deps (verify actual latest-compatible versions against Vite 8/React 19 at implementation time): `vitest`, `@testing-library/react` (v16+, React 19 support), `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `msw` (v2).
- `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`.
- `vitest.config.ts` (or a `test` block in `vite.config.ts`): `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`.
- Colocated `*.test.ts(x)` next to source (matches the codebase's existing small-focused-module style).

**(a) Konva canvas editor** — don't try to assert on canvas pixel output (jsdom has no real `<canvas>` 2D context):
- Test `geometry.ts` directly and fully (`snapToGrid`, `boundingRect`, `rectangleToPolygon`, `polygonToRectangle`, `colorForSlug`/`colorsForBedCategory`, `formatDistanceCm`) — zero Konva, zero DOM, currently zero coverage.
- For `BedNode.tsx`/`PolygonEditor.tsx`/`PlantPlacementLayer.tsx`/`GardenBoundary.tsx`: `vi.mock("react-konva", ...)` to stub `Stage`/`Layer`/`Rect`/`Line`/`Circle` as passthrough components, so tests can assert on prop-wiring/event-handler logic (e.g. "dragging by (10,20) calls `onChange` with geometry shifted and snapped correctly") without real canvas rendering.
- Don't install a `canvas`-polyfill package to force real Konva mounting — buys "doesn't crash" at real native-binding cost, no real assertion power. Skip it.
- True visual/interaction verification stays deferred until a browser-automation tool is available — don't fake it with a canvas-mock smoke test.

**(b) TanStack Query + `api/client.ts`** — mock at the `fetch`/network boundary via **MSW**, not by mocking `client.ts`'s functions directly. Handlers mirror `schema.d.ts`'s generated shapes, so a stale mock shows up as a type error, not a silent pass. Wrap renders in a fresh `QueryClientProvider` (`retry: false`) per test.

**(c) shadcn/ui + `@base-ui/react` forms** — real semantic DOM, standard RTL `getByRole`/`userEvent` should work for plain inputs without special shimming. Verify empirically per component; if portal-based primitives (popovers/comboboxes) prove flaky in jsdom, prefer asserting on committed form state after submit over intermediate open/close DOM state.

### Data/ETL

- `data/pyproject.toml` dev deps: add `pytest`. Skip `pytest-mock` unless it earns its keep (stdlib `unittest.mock`/`monkeypatch` suffice for this surface).
- Layout: `data/tests/` mirroring `data/etl/`'s structure, plus `data/tests/fixtures/` holding **trimmed, committed** copies of real cached shapes (one real Trefle response, one real Permapeople response, etc.) — don't read `.cache/` live (gitignored, non-reproducible).
- Same `pytest.ini_options` marker pattern as backend; register `ollama: needs a real local Ollama install`.

**Highest-value first tests:**
1. `test_merge.py` — `merge_plant`: single-source unambiguous, two-sources-agree collapses without an LLM call, two-sources-disagree produces a real conflict. Zero coverage today.
2. `test_export.py::test_validate` — valid/invalid docs against `plant.schema.json`.
3. `test_export.py::test_build_plant_json` — assembled dict shape (attribution, `kamokamo` manual-override path, inferred-botanical-name flag), with `resolve_scalar_field`/`infer_botanical_name` mocked (network+Ollama-free).
4. `sources/test_trefle.py` — trimmed real cached fixture, regression-guards the `main_species.specifications.growth_habit`-vs-top-level-null bug that already happened once.
5. Cultivar-merge regression test (`data/etl/CLAUDE.md`'s Acorn Squash/Zucchini/Pumpkin/Delicata/Pattypan/Spaghetti Squash false-merge-via-`Cucurbita pepo` bug) — must never regress.

**Ollama testing approach**: unit-test everything except the live model call by mocking `_call_ollama` (prompt construction, field-type schema selection, exception fallback, `conflicts_log.jsonl` writing) — runs everywhere, no Ollama needed. A small number of `@pytest.mark.ollama`-marked tests do a real end-to-end smoke check against a real local Ollama, skipped by default (mirrors backend's `integration` marker pattern).

## Phase 2 — Wire into skills, expand core coverage

- **`test-backend/SKILL.md`**: note that DB-backed `integration`-marked tests self-skip with an explicit message when `TEST_DATABASE_URL` isn't set (report the skip plainly, never as a pass). Consider a new `.claude/skills/test-backend/scripts/backend_test_integration.ps1` script alongside the existing `backend_test.ps1`. Update the "coverage is thin" note once Bed/Garden/Planting/BedEquipment tests land.
- **`test-frontend/SKILL.md`**: replace the stub with `npm run test` (or a new `.claude/skills/test-frontend/scripts/frontend_test.ps1`). Note Konva visual/interaction behavior is *not* covered by design; real browser-driven verification stays blocked pending a browser-automation tool. Keep `/build-frontend` as complementary, not overlapping.
- **`test-data/SKILL.md`**: replace the stub with `uv run pytest` (unmarked) by default, `-m ollama` only when Ollama is confirmed running. Keep the fixture-validator and lint step as-is — this adds unit coverage alongside them.
- Backend: extend CRUD coverage to `Plant` + its 8 satellite tables and the remaining routes.
- Frontend: page-level tests for `BedPanel`/`GardenPanel`/`ExampleGardenView` composing MSW + mocked-Konva children.
- Data: `normalize.py`, `state.py` (checkpoint/resume correctness — the actual payoff of the per-plant pipeline structure), remaining source mappers.

## Phase 3 — Hardening / expansion (opportunistic, not blocking)

- Backend: `commit_or_409` edge cases across every route module, `app/services/taxonomy.py`, APScheduler job registration (likely mocked), a routine (not one-off) migration regression check.
- Frontend: broaden MSW-mocked page tests as new pages/panels land; re-evaluate real canvas/browser testing once a browser-automation tool exists.
- Data: end-to-end pipeline smoke test — trimmed fixtures for all 6 sources through merge → mocked-resolve → export/validate, entirely offline.

## Critical files for implementation

- `backend/tests/conftest.py` (new) — the crux of the backend integration-test strategy
- `backend/app/core/db.py` — `get_session` is the dependency-override seam
- `backend/pyproject.toml`, `.env.example` — marker registration, `TEST_DATABASE_URL` documentation
- `frontend/package.json`, `frontend/vitest.config.ts` (new) — frontend test tooling entry point
- `frontend/src/pages/layout/geometry.ts` — first frontend test target, zero-Konva pure logic
- `data/pyproject.toml`, `data/tests/fixtures/` (new) — data/ETL test tooling entry point and fixture convention
- `.claude/skills/test-backend/SKILL.md`, `test-frontend/SKILL.md`, `test-data/SKILL.md` — update directly from this plan once each phase lands
