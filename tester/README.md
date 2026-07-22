# tester

Home directory for the `tester` agent (`.claude/agents/tester.md`). Its actual test code lives where each framework naturally expects it - `backend/tests/`, `frontend/**/*.test.ts(x)`, `frontend/e2e/` - not here. This directory only holds the agent's own local state:

- `.agent-scratch.md` (gitignored) - interrupted-run recovery notepad.

No committed content is expected here beyond this README.
