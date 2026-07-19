---
name: git
description: Stage, commit, and push changes in this repo (add/remove/commit/push). Use whenever asked to commit and/or push - not for branch management, rebasing, or history rewriting, which stay manual/human-only here.
allowed-tools: PowerShell(git *)
---

This project has no `Bash` shell available in this environment ("No suitable shell found") - **always use the `PowerShell` tool for git, never `Bash`.**

## Staging

Stage explicitly by path. **Never `git add -A` or `git add .`** - this repo regularly has unrelated work in progress from other tasks/agents (e.g. the `data-engineer` subagent's own scoped commits) sitting uncommitted at the same time; a blanket add sweeps that in too.

- `git add <path> <path> ...` for new/modified files (check `git status` first to see what's actually yours to stage)
- `git rm <path>` to remove a tracked file as part of a commit (only when actually asked to remove something, not as a way to "clean up" unrelated untracked files - see the Git Safety Protocol below)

## Committing

**PowerShell quoting gotcha, specific to this repo**: `git commit -m $msg` breaks if `$msg` contains embedded double-quotes (PowerShell prematurely closes the argument boundary passed to `git.exe`, producing spurious extra arguments). **Always write the commit message to a scratch file and use `git commit -F <file>`** instead of `-m`, even for short messages - don't risk it. Use the scratchpad directory for the message file.

Message style: 1-2 sentences on *why*, not a bullet-by-bullet *what* (the diff already shows that). Match this repo's existing log style (`git log` to see recent examples) - it favors non-obvious rationale over a change inventory.

End every commit message with:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: <this session's URL>
```

**Only commit when explicitly asked.** Don't commit proactively just because a task finished.

## Pushing

Check `git branch --show-current` first (this repo's active branch may not be `main` - the default push target). `git push` to that branch. **Never force-push, never push to `main` without explicit confirmation.**

If the push fails because the remote has diverged, stop and report - don't `pull`/rebase/force-push to work around it without asking.

## What this skill does not cover

Branch creation/switching/deletion, `rebase`, `reset --hard`, amending a pushed commit, `checkout`/`restore`/`clean` that would discard uncommitted work - all of these stay explicit, human-confirmed actions, not something this skill automates. If a task seems to need one of these, stop and ask rather than reaching for it.

Before any of the destructive operations above (even if explicitly requested), run `git status` first to check for uncommitted work that would be lost.
