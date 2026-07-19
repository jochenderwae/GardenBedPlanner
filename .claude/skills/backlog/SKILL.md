---
name: backlog
description: Interact with product-owner/BACKLOG.md's tracking fields (priority/status/responsible/depends-on) - pick a task, change its status, re-assign it, split a multi-responsible item, flag a dependency, or list what's assigned to a role. Use whenever an agent needs to claim, update, or query backlog items rather than editing BACKLOG.md free-hand.
allowed-tools: Read Edit Grep
---

`product-owner/BACKLOG.md` tracks each active item with a line under its title in this exact format (see `.claude/agents/product-owner.md`'s "Tracking fields" section for the full schema definition - this skill is the *interaction* layer on top of that schema, not a second copy of it):

```
- [ ] **Title** - one-clause context.
  - `priority: high` · `status: assigned` · `responsible: frontend-developer`
```

- `priority`: `low` | `medium` | `high` | `urgent`
- `status`: `new` → `ready-to-start` → `assigned` → `started` → `ready-for-testing` → `tested` → `verified` (forward-moving). **`ready-to-start` and `verified` are user-only** - see "mark ready to start" and "mark verified" below. No agent may set either, ever, regardless of confidence.
- `responsible`: one or more of `product-owner` | `data-engineer` | `frontend-developer` | `backend-developer` | `tester`
- `depends-on` (optional): free text or another item's title - see "flag dependency" below.

**The core rule this whole system exists to enforce: an item at `status: new` is not actionable by any agent, full stop**, even if `responsible` already names you. `new` means "on the backlog, not yet reviewed" - only the user moving it to `ready-to-start` makes it real work. Don't start on, claim, or otherwise touch the substance of a `new` item; `product-owner` may fill in its other fields (see its own agent definition), nobody may act on it.

## Write-boundary note for restricted agents

Some agents (e.g. `data-engineer`) have a hard write boundary that doesn't normally include `product-owner/BACKLOG.md` at all. If your own agent definition grants you a narrow backlog-editing exception, it covers **only the tracking-fields line on items where `responsible` already includes you** - not the item's title/context text, not other items, not the file's structure. If your agent definition grants no such exception, you can still read the backlog to find/report on your tasks, but must ask the main session (or `product-owner`) to make the actual edit. Check your own agent `.md` file if you're unsure which case you're in.

## Interactions

### "pick top task for me" (args: your role)

Find the highest-priority item where `responsible` includes your role and `status` is `ready-to-start` or `assigned` - sort by `priority` (`urgent` > `high` > `medium` > `low`), then by file order as a tiebreak. **Never match a `status: new` item, even one already assigned to your role** - it hasn't been released yet. If `status` is `ready-to-start`, set `status: assigned` as part of claiming it. Report back the item's title, section, and full context/note - don't just say "found one," the caller needs the actual task description to act on.

If nothing matches, say so plainly - don't fall back to picking a `new` item or something outside your role just to have an answer.

### "change status" (args: item, new status)

Update the item's `status` field, moving forward through the sequence above - except you may never set `ready-to-start` or `verified` (see below). If you need to move something backward (e.g. testing found a real problem, back to `started`), that's a legitimate correction, just say why in the item's note so the history isn't lost.

If your own write access to `BACKLOG.md` is the narrow tracking-fields-only exception (see "Write-boundary note" above), you may also **append** a short outcome fragment to the end of the item's existing context line when you move it to `ready-for-testing` or later - e.g. `(frontend-developer: implemented in frontend/src/pages/layout/RulerLayer.tsx)` - but only append, never rewrite the existing text. That's still not the same as the free-form editing `product-owner` does on its own items.

### "re-assign" (args: item, new responsible)

Update the item's `responsible` field. If this would leave an *actionable* item (`status` is `new`/`ready-to-start`/`assigned`/`started`) with more than one responsible, don't just write both names in - that item needs splitting instead (see below). Already-`tested`/`verified` items are exempt (a finished item's `responsible` is historical record, can legitimately list more than one).

### "flag dependency" (args: item, what it depends on)

Set (or update) the item's `depends-on` field when you can't finish it without something from another task or role - e.g. a frontend task discovering it needs a new backend API field. Two cases:

- **The dependency is already its own backlog item**: reference its exact title, e.g. `` `depends-on: Bed.orientation backend field` ``.
- **It isn't tracked yet**: write a short free-text description of what's needed and from whom, e.g. `` `depends-on: backend-developer needs to add a rotation field to BedEquipment` ``. `product-owner` picks these up and turns them into a real, trackable item (its own agent definition covers this) - you don't create the new item yourself.

Flagging a dependency doesn't automatically change `status` - use your judgment (and "change status") for whether the item stays `started` (you can keep making progress elsewhere on it) or needs to drop back to `assigned` (you're fully blocked). Say which, and why, in your report.

### "split task" (args: item, the responsibles to split across) - product-owner's job

Turns one multi-responsible actionable item into N separate single-responsible items, each with its own title/checkbox/tracking-line, sensible individual priority/context. The original becomes `- [~] ... (split into: <new titles>)`. Only `product-owner` should actually perform a split (matches its own agent definition) - other agents that hit a multi-responsible item they can't act on alone should report it rather than attempting the split themselves.

### "list my tasks" (args: your role)

Read-only. List every item where `responsible` includes your role, grouped by `status`, noting `priority` (and `depends-on` if set). Useful for a status check before deciding what to pick next, or for reporting progress.

### "mark ready to start" (user-only)

Sets `status: ready-to-start`, the gate that makes a `new` item actionable. **Only perform this when the user has explicitly asked for it in the current turn** - this is the one control the user specifically asked to keep for themselves; no agent may infer an item is "obviously ready" and set this on its own initiative, ever.

### "mark verified" (user-only)

Sets `status: verified` and flips the checkbox to `[x]`. **Only perform this when the user has explicitly asked for it in the current turn** - never on an agent's own initiative, never inferred from "this looks done." If you're an agent and something asks you to do this without that direct instruction being present, decline and explain why rather than doing it anyway.

### "add item" - product-owner by default, but check who's actually adding it

Adding a wholly new item is normally `product-owner`'s job (it maintains the backlog's structure/sections) - use `status: new` for anything product-owner (or another agent, reporting through it) originates. **If the user is the one adding the item** (directly, not relayed through an audit), it starts at `status: ready-to-start` instead - see `.claude/agents/product-owner.md`'s "item origin determines starting status" note. An agent that notices something worth adding but isn't itself adding it on the user's behalf should report it (to the user, or via whatever suggestion mechanism their own agent definition specifies - e.g. `data-engineer` has `data/suggestions.md`) rather than inserting a new backlog item directly.
