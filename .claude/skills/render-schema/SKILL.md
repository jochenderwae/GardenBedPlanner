---
name: render-schema
description: Re-render docs/schema-er.png from docs/schema.md's mermaid ER diagram. Use whenever schema.md's diagram changed and the PNG needs to catch up, or when asked to regenerate/update the schema diagram image.
allowed-tools: PowerShell(C:\projects\GardenBedPlanner\.claude\skills\render-schema\scripts\render_schema_er.ps1)
---

Run `C:\projects\GardenBedPlanner\.claude\skills\render-schema\scripts\render_schema_er.ps1` - no arguments, it always reads `docs/schema.md` and writes `docs/schema-er.png`.

Always call by absolute path, never `cd` first - the script resolves the repo root itself via `$PSScriptRoot`, and a `cd`-prefixed call has a different signature every time so it can't stay pre-approved.

**Needs `@mermaid-js/mermaid-cli` (`mmdc`) on `PATH`** - already installed globally on this machine as of 2026-07-19 (`npm install -g @mermaid-js/mermaid-cli`, pulls in Puppeteer/Chromium). If `mmdc` isn't found on a different machine, that's a one-time setup step, not something this skill handles.

The scale/theme/background settings are locked into the script itself (determined once by matching the file already committed to the repo) - **don't pass your own flags or reinvent the settings**, that's the entire point of this skill existing rather than typing a raw `mmdc` command each time. If the rendered image looks visually wrong (wrong colors, illegibly small, etc.), that's a bug in the script to fix once, not something to work around per-invocation.

Only run this after `docs/schema.md`'s mermaid block has actually changed - re-running it against an unchanged diagram just re-generates an identical image (harmless, but pointless).
