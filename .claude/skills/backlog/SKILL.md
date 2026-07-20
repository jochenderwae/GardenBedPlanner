---
name: backlog
description: Interact with the GardenBedPlanner GitHub Project (https://github.com/users/jochenderwae/projects/1) - pick a task, change its status, re-assign it, split a multi-responsible item, flag a dependency, list what's assigned to a role, or add a new item. Use whenever an agent needs to claim, update, or query backlog items. Replaces the old product-owner/BACKLOG.md-based version of this skill (deprecated 2026-07-20, see that file's own header note) - same interactions, same governance rules, now backed by real GitHub Issues/Project fields instead of a markdown tracking-fields line.
allowed-tools: Read PowerShell
---

**As of 2026-07-20, the GitHub Project is ground truth for backlog planning - `product-owner/BACKLOG.md` is deprecated (kept only as a historical record, never edited again).** Every item is a real GitHub Issue on `jochenderwae/GardenBedPlanner`, added to the Project, with:

- **`priority`** (`low`/`medium`/`high`/`urgent`) - a custom Project field.
- **`status`** (`new` → `ready-to-start` → `assigned` → `started` → `ready-for-testing` → `tested` → `verified`, forward-moving) - a custom Project field (built on GitHub's default "Status" field, reconfigured to these 7 options). **`ready-to-start` and `verified` are user-only** - see `mark_ready_to_start.ps1`/`mark_verified.ps1` below. No agent may set either, ever, regardless of confidence.
- **`responsible`** - `role:<name>` label(s): `role:product-owner`, `role:data-engineer`, `role:frontend-developer`, `role:backend-developer`, `role:tester`.
- **area** (was the old `## Section` heading) - an `area:<name>` label, e.g. `area:bed-crop-planning`, `area:plant-database`. See `_config.ps1` or `gh label list` for the full set.
- **`depends-on`** - a real GitHub "blocked by" relationship (`gh issue edit --add-blocked-by`), not free text.
- **split items** - a real parent/sub-issue relationship (GitHub's native sub-issues feature), not a `[~] ... split into: ...` pointer line.
- **dropped items** - closed with `state_reason: not_planned` and a comment, not a `[~] ... dropped: ...` line.

**The core rule this whole system exists to enforce is unchanged from the BACKLOG.md era: an item at `status: new` is not actionable by any agent, full stop**, even if a `role:*` label already names you. `new` means "on the backlog, not yet reviewed" - only the user moving it to `ready-to-start` makes it real work.

## Scripts

Every interaction below is a PowerShell script in `.claude/skills/backlog/scripts/`, dot-sourcing the shared `_config.ps1` (project ID, field IDs, option-ID maps, role list, `Get-AllProjectItems`/`Get-ProjectItemByNumber`/`Set-StatusField`/`Set-PriorityField` helpers - read it once if you're curious how the opaque GraphQL IDs are wired up, you shouldn't need to touch it). **Call every script by its absolute path**, same convention as every other skill in this project - see `.claude/skills/README.md`.

### "pick top task for me" (args: your role)

```
.claude\skills\backlog\scripts\pick_top_task.ps1 -Role frontend-developer
```

Finds the highest-priority item labeled `role:<you>` with Status `Ready to Start` or `Assigned` (never `New` - not released yet; never `Started`/`Ready for Testing`/`Tested` - already someone's active work, not a fresh pick). Claims it (`Ready to Start` → `Assigned`) if needed, then prints the full issue body so you have the actual task description, not just a title.

If nothing matches, it says so plainly - don't fall back to a `New` item or something outside your role.

### "change status" (args: issue number, new status)

```
.claude\skills\backlog\scripts\set_status.ps1 -Number 42 -Status started
```

Accepts `assigned`/`started`/`ready-for-testing`/`tested` - **refuses `ready-to-start` and `verified` outright** (throws, doesn't silently no-op). Moving backward (e.g. testing found a real problem, back to `started`) is allowed - that's a legitimate correction, just say why in your report/PR/commit so the history isn't lost. If you have the narrow BACKLOG.md-era "append an outcome note" habit: the equivalent now is `gh issue comment <number> --body "..."` - comment on the issue, don't try to rewrite its body (the body is the original task description, not a running log).

### "re-assign" (args: issue number, new role, optionally old role to remove)

```
.claude\skills\backlog\scripts\reassign.ps1 -Number 42 -NewRole backend-developer -OldRole frontend-developer
```

Swaps `role:*` labels. If this leaves an *actionable* item (status new/ready-to-start/assigned/started) with more than one role label, the script warns - that item needs **splitting** instead (below), not multiple simultaneous owners. Already-tested/verified items are exempt (historical record of who built it, can legitimately list more than one).

### "flag dependency" (args: your issue, the issue it's blocked by)

```
.claude\skills\backlog\scripts\flag_dependency.ps1 -Number 42 -DependsOnNumber 17
```

Sets a real "blocked by" relationship. **The dependency must already be a real issue** - if it isn't tracked yet, use "add item" below to create it first (that's `product-owner`'s job to triage/refine, same as the BACKLOG.md era's "product-owner picks up untracked depends-on text"), then flag against its real number. Don't invent a free-text workaround.

Flagging a dependency doesn't change status on its own - use "change status" for whether the item stays `started` (you can keep making progress elsewhere on it) or drops back to `assigned` (fully blocked). Say which, and why, in your report.

### "split task" (args: item, the roles to split across) - product-owner's job

Turns one multi-responsible actionable item into N separate single-responsible items, using GitHub's native sub-issue relationship:

1. Create the parent as a tracking-only issue (no `-Priority`/`-Origin`, so it gets no Status/Priority field value - it's a pointer, not actionable work): `add_item.ps1 -Title "..." -BodyFile ... -Area ...`.
2. Create each child with `-ParentNumber <parent-issue-number>`, its own real `-Priority`/`-Origin`/`-Roles`.

Only `product-owner` should actually perform a split. Other agents that hit a multi-responsible item they can't act on alone should report it rather than attempting the split themselves.

### "list my tasks" (args: your role)

```
.claude\skills\backlog\scripts\list_tasks.ps1 -Role backend-developer
```

Read-only. Every open item labeled `role:<you>`, grouped by status, sorted by priority within each group.

### "mark ready to start" (args: issue number) - USER-ONLY

```
.claude\skills\backlog\scripts\mark_ready_to_start.ps1 -Number 42
```

Sets Status to `Ready to Start`, the gate that makes a `New` item actionable. **Only run this when the user has explicitly asked for it in the current turn** - the one control the user specifically asked to keep for themselves. No agent may infer an item is "obviously ready" and run this on its own initiative, ever. The script doesn't hard-block an agent from invoking it (no per-field GitHub permission model exists at this account tier to enforce that technically) - this is a discipline rule, same as it was in the BACKLOG.md era.

### "mark verified" (args: issue number) - USER-ONLY

```
.claude\skills\backlog\scripts\mark_verified.ps1 -Number 42
```

Sets Status to `Verified` and closes the issue as completed. **Only run this when the user has explicitly asked for it in the current turn** - never on an agent's own initiative, never inferred from "this looks done." If asked to do this without that direct instruction present in the current turn, decline and explain why rather than doing it anyway.

### "add item" (args: title, body, area, optionally roles/priority) - product-owner by default

```
.claude\skills\backlog\scripts\add_item.ps1 -Title "..." -BodyFile <path> -Area bed-crop-planning -Roles @("frontend-developer") -Priority medium -Origin agent
```

Adding a wholly new item is normally `product-owner`'s job. `-Origin agent` starts it at Status `New`; **if the user is the one adding it directly** (not relayed through an audit), use `-Origin user` instead so it starts at `Ready to Start` - matches the old "item origin determines starting status" rule exactly, just renamed from a markdown convention to a script flag. An agent that notices something worth adding but isn't itself adding it on the user's behalf should report it (to the user, or via whatever suggestion mechanism their own agent definition specifies - e.g. `data-engineer` still has `data/suggestions.md`) rather than calling this directly.

`-BodyFile` takes a path, not an inline string - write the body to a scratch file first (multi-paragraph markdown survives a file far better than shell-quoting).
