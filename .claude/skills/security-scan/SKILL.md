---
name: security-scan
description: Runs bandit (Python security static analysis) against backend/app and data/etl. Use whenever asked to run a static security scan, check for common Python security anti-patterns (hardcoded secrets, weak crypto, unsafe subprocess/deserialization/SQL construction, etc.), or as part of a broader security review.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\security-scan\scripts\backend_security_scan.ps1) PowerShell(C:\projects\GardenBedPlanner\.claude\skills\security-scan\scripts\data_security_scan.ps1)
---

Bandit is a static analyzer for common Python security anti-patterns - hardcoded passwords/secrets, SQL built via string formatting, unsafe `subprocess`/`eval`/`pickle`/`yaml.load` use, weak crypto/hashing, insecure temp-file handling, and more (full check list: https://bandit.readthedocs.io/en/latest/plugins/index.html). It's a *pattern* scanner, not exploit verification - it catches the mechanical/syntactic cases; SSRF, business-logic auth gaps, and anything context-dependent still need a human/agent reading the code, which is exactly what `security-analyst` (`.claude/agents/security-analyst.md`) does on top of this.

Run both (frontend has no Python to scan, so there's no third script):

1. `C:\projects\GardenBedPlanner\.claude\skills\security-scan\scripts\backend_security_scan.ps1`
2. `C:\projects\GardenBedPlanner\.claude\skills\security-scan\scripts\data_security_scan.ps1`

Always call by absolute path, never `cd` first - each script resolves the repo root itself via `$PSScriptRoot`.

Both projects' `pyproject.toml` has a `[tool.bandit]` section skipping `B101` (`assert_used`) project-wide - real signal in code that leans on `assert` for a security check, pure noise here since this codebase only ever uses `assert` for internal invariants, not as a security control. As of 2026-07-21 both scan clean at that config; a scan running clean is the expected baseline, not a low bar - a new finding means something real changed. Don't silently add more skips to make a real finding go away - if a specific flagged line is a genuine false positive, use an inline `# nosec BXXX` with a comment explaining why, not a blanket config change.

Report results plainly - a finding's severity/confidence, file/line, and the actual code snippet bandit prints, not just a pass/fail summary.

This is also wired into CI (`.github/workflows/ci.yml`'s `backend`/`data` jobs) as a blocking step, so a real finding fails the build on push, not just when `security-analyst` happens to run.
