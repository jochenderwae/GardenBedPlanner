# e2e

Playwright end-to-end specs, run headless via `npm run test:e2e` (see `frontend/playwright.config.ts`). Owned by the `tester` agent (`.claude/agents/tester.md`) - it writes real specs here per backlog ticket, covering interactive/browser flows that a Vitest unit test can't (drag-and-drop on the canvas editor, multi-step forms, navigation).

No specs exist yet as of this directory's creation (2026-07-22) - the framework was just wired up (`@playwright/test` installed, config pointing at the local dev server, browser binaries present). The first real `*.spec.ts` file here should replace this README's "no specs yet" note.
