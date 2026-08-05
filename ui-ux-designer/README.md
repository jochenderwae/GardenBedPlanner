# ui-ux-designer

Home directory for the `ui-ux-designer` agent (`.claude/agents/ui-ux-designer.md`).

- `reviews/` - dated, committed write-ups from periodic screen-evaluation passes (`<date>-review.md`).
- `screenshots/` (gitignored) - ephemeral Playwright captures used for a visual pass, when Playwright is available.
- `.agent-scratch.md` (gitignored) - interrupted-run recovery notepad.
- `.last-reviewed-commit` (gitignored) - the `frontend/` HEAD SHA as of the last full periodic evaluation, used to gate unforced sweeps to roughly every 10 frontend commits.

Actual design specs for a specific feature/ticket are written inline into the GitHub issue itself (via `/backlog`), not as separate files here - only the periodic review write-ups get their own committed doc.

## External input worth checking

- `product-owner/research/user-journeys-dave.md` (added 2026-08-03) - a persona/user-journey doc supplied by the user, phase-by-phase across a gardening year with touchpoints and thoughts. Lives under `product-owner/research/` since it's primarily a gap-analysis input for that agent, but its per-phase "Touchpoint" column is directly relevant to UX/interaction work here too - worth reading when evaluating screens or specifying tickets touched by these flows (planning/wishlist, task/notification-driven work sessions, harvest logging, stock/shopping-list integration, drip irrigation setup).
