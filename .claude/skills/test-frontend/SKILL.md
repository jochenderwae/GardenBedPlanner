---
name: test-frontend
description: Run the frontend's test suite. Use whenever asked to test, verify, or check the frontend's tests pass.
allowed-tools: PowerShell(npm *)
---

**No frontend test framework is configured yet** as of this skill's creation - `frontend/package.json` has no `test` script and no test runner (`vitest`, `jest`, etc.) installed. See `docs/testing-plan.md` (Phase 1, Frontend section) for the concrete plan: Vitest + React Testing Library + MSW, jsdom, `vi.mock("react-konva", ...)` for the canvas components (pure logic like `geometry.ts` gets tested directly, Konva rendering itself doesn't), and the first tests to add.

Until that lands:

1. Check `frontend/package.json` for a `test` script - if one now exists (the plan may have been implemented since this skill was written), run it via `npm run test` (or `npm test`) from `frontend/` and treat this skill as current, no update needed.
2. If there's still no `test` script, **say so explicitly** rather than reporting false success or silently substituting something else - run `/build-frontend` instead (typecheck + lint), which is the closest thing to verification currently available, and be clear that it is not a substitute for real test coverage.

Do not invent an ad-hoc test setup inline to work around the gap - that's exactly the kind of scattered, one-off tooling the skills migration this repo just did was meant to avoid. Flag it and point at `docs/testing-plan.md` instead.
