---
name: test-frontend
description: Run the frontend's test suite. Use whenever asked to test, verify, or check the frontend's tests pass.
allowed-tools: PowerShell(npm *)
---

**Update (2026-07-21): Vitest is now configured** - `frontend/package.json` has a real `test`/`test:watch` script (`vitest run` / `vitest`) and pure-logic unit tests exist (`geometry.test.ts`, `viewport.test.ts`, `history.test.ts`, `CompassWidget.test.ts`, `agendaMonths.test.ts`, `seedGuide.test.ts`). Run via `npm run test` from `frontend/`.

**Still a real gap, not yet closed:** no `@testing-library/react`/`jsdom`/`msw` (component-level rendering tests), and no Playwright or other browser-automation tool (true interactive/visual verification) - see `docs/testing-plan.md` Phase 1(b)/(c) for the plan. The `tester` agent (`.claude/agents/tester.md`) owns deciding whether/when to add these, not this skill - if asked to test something that genuinely needs component rendering or a real browser and neither is installed, say so explicitly rather than reporting false success or silently substituting a weaker check. `/build-frontend` (typecheck + lint) remains complementary verification, not a substitute for test coverage.

Do not invent an ad-hoc test setup inline to work around a gap - that's exactly the kind of scattered, one-off tooling the skills migration this repo did was meant to avoid. Flag it and point at `docs/testing-plan.md` instead (or, for the tester agent specifically, its own agent definition's framework-setup workflow).
