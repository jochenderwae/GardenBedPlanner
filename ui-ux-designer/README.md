# ui-ux-designer

Home directory for the `ui-ux-designer` agent (`.claude/agents/ui-ux-designer.md`).

- `reviews/` - dated, committed write-ups from periodic screen-evaluation passes (`<date>-review.md`).
- `screenshots/` (gitignored) - ephemeral Playwright captures used for a visual pass, when Playwright is available.
- `.agent-scratch.md` (gitignored) - interrupted-run recovery notepad.
- `.last-reviewed-commit` (gitignored) - the `frontend/` HEAD SHA as of the last full periodic evaluation, used to gate unforced sweeps to roughly every 10 frontend commits.

Actual design specs for a specific feature/ticket are written inline into the GitHub issue itself (via `/backlog`), not as separate files here - only the periodic review write-ups get their own committed doc.
