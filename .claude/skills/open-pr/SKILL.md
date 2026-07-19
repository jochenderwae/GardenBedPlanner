---
name: open-pr
description: Open a GitHub pull request for the current branch. Use when asked to open/create a PR.
allowed-tools: PowerShell(git *) PowerShell(gh *)
---

Uses `gh` (GitHub CLI) directly - no wrapper script for this one, since the title/body genuinely vary per PR and can't be pre-approved as a fixed command the way the other skills' scripts can.

1. Check branch state: `git status`, `git diff` (staged + unstaged), whether the branch tracks a remote and is up to date, and `git log`/`git diff <base>...HEAD` to see the **full** set of commits going into the PR - not just the latest one.
2. Push the branch first if it isn't already up to date on the remote (`git push -u origin <branch>` if it has no upstream yet).
3. Draft a short PR title (under ~70 chars) and a body with a `## Summary` (1-3 bullets) and a `## Test plan` checklist, based on everything the PR actually contains - all its commits, not just the most recent one.
4. Create it via a heredoc so formatting survives PowerShell's quoting rules cleanly:
   ```
   gh pr create --title "..." --body "$(cat <<'EOF'
   ## Summary
   - ...

   ## Test plan
   - [ ] ...
   EOF
   )"
   ```
5. Return the PR URL.

This repo's base branch is `main`; the working branch is usually `dev` (see root `CLAUDE.md`'s git status conventions) - confirm the actual current branch (`git branch --show-current`) rather than assuming.

Don't create, switch, or delete branches as part of this - only push the existing current branch and open the PR against its already-established base.
