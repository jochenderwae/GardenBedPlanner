# GardenBedPlanner color schemes — three options

Status: proposal, not yet chosen or implemented. Written by `ui-ux-designer`,
2026-07-27. Nobody has commit authority to act on this file except whoever
the user tells to implement it — this document is the full spec for that
work, not a partial one.

## Why these three, and not variations on one idea

The app currently ships shadcn/ui's stock achromatic default theme
(`frontend/src/index.css`: every neutral and every "color" token is
`oklch(_ 0 0)` — literally zero chroma, including `--chart-1` through
`--chart-5`, which is what originally got this flagged). The only real color
in the app today lives in `ui-ux-designer/assets/icon-source.svg`: primary
green `#2f6f3e` (the PWA manifest's `theme_color`), a lighter sage tint
`#82a98b`, wood-brown `#8a5a34`, and soil `#5c3a20` — a raised-bed-plus-sprout
mark grounded in real garden materials (wood, soil, leaf).

All three schemes below stay grounded in that identity — garden, growing,
soil, outdoors — but take genuinely different routes through it rather than
offering three shades of the same green:

1. **Kitchen Garden** — the icon's own green, used directly as the app's
   primary. Fresh, friendly, the "expected" choice.
2. **Terracotta & Clay** — warm-forward. Primary shifts to a clay-pot
   terracotta/burnt-orange; green is demoted to a secondary/accent role.
   Still unmistakably garden (terracotta pots, sun-baked soil), but the app
   no longer reads as "the green app" at a glance.
3. **Botanical Slate** — cool and moody. Deep, saturated forest/moss green
   on cool slate-blue neutrals, with a "greenhouse glass" teal accent.
   More premium/editorial, and the direction that looks best if the app
   defaults to dark mode.

One thing kept **deliberately constant across all three**: `--destructive`
stays a recognizable red (hue ~24–27 in every scheme, only lightness/chroma
nudged to sit comfortably against each scheme's neutrals). Danger/delete
affordances should stay universally readable as "red" regardless of which
brand direction wins — that's a semantic color, not a mood color, so it's
not a place to express the scheme's personality.

## Format and how to read the tables

- All values are OKLCH, matching the convention already in
  `frontend/src/index.css` (`oklch(L C H)`, e.g. `oklch(0.205 0 0)`).
- Every token from the prompt is specified for both `:root` (light) and
  `.dark`: `background`, `foreground`, `card`, `card-foreground`, `primary`,
  `primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
  `muted-foreground`, `accent`, `accent-foreground`, `destructive`,
  `destructive-foreground`, `border`, `input`, `ring`, `chart-1`…`chart-5`.
- `index.css` also declares `popover`/`popover-foreground` and a `sidebar-*`
  family that the prompt didn't explicitly list but that a full swap-in
  needs values for too, so each scheme includes a short "supplementary
  tokens" table for those (`popover` mirrors `card`, `sidebar-*` mirrors
  `card`/`accent`/`border` — the standard shadcn pattern of the sidebar
  being a quiet echo of the card surface, not a fourth color story).
- Non-color tokens (`--sans`, `--radius`, font size/letter-spacing, the
  `@theme inline` mapping block) are unaffected by any of this and don't
  need to change.
- Contrast check: rather than a formal WCAG tool, every foreground/background
  pairing below was chosen for a large gap in OKLCH `L` (lightness) — body
  text pairs sit at ~0.4–0.8 `L` apart, which is comfortably more than the
  ~0.41 gap already shipping today between `--muted-foreground` (0.556) and
  `--muted` (0.97). Anywhere the gap is tighter (e.g. a saturated
  primary/destructive button with a light foreground) it's checked against a
  real-world equivalent color known to pass AA at that saturation/lightness
  (e.g. scheme 1's primary is very close to the actual shipped `#2f6f3e`
  green, which already reads fine with white text).

---

## Scheme 1 — Kitchen Garden

**Feel:** fresh, friendly, unmistakably the same green as the app icon —
this is the "safe default" of the three, closest to the existing identity,
good if the goal is "give the achromatic theme actual color" without
changing the app's personality. Neutrals get a whisper of warm chroma
(sun-warmed cream/soil, not clinical gray) instead of staying pure `0 0`.

### Light (`:root`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.99 0.004 95)` | near-white, faint warm cream |
| `--foreground` | `oklch(0.18 0.02 145)` | near-black, whisper of green-black |
| `--card` | `oklch(0.995 0.003 95)` | |
| `--card-foreground` | `oklch(0.18 0.02 145)` | |
| `--primary` | `oklch(0.48 0.11 142)` | ≈ icon green `#2f6f3e` |
| `--primary-foreground` | `oklch(0.98 0.01 145)` | |
| `--secondary` | `oklch(0.95 0.02 130)` | pale sage |
| `--secondary-foreground` | `oklch(0.28 0.04 145)` | |
| `--muted` | `oklch(0.96 0.012 95)` | warm pale gray |
| `--muted-foreground` | `oklch(0.48 0.02 110)` | |
| `--accent` | `oklch(0.88 0.09 85)` | warm gold/sand (mulch, sun) |
| `--accent-foreground` | `oklch(0.28 0.05 85)` | |
| `--destructive` | `oklch(0.577 0.245 27)` | |
| `--destructive-foreground` | `oklch(0.98 0.01 27)` | |
| `--border` | `oklch(0.90 0.015 100)` | |
| `--input` | `oklch(0.90 0.015 100)` | |
| `--ring` | `oklch(0.55 0.10 142)` | |
| `--chart-1` | `oklch(0.55 0.14 142)` | green (primary family) |
| `--chart-2` | `oklch(0.62 0.16 55)` | terracotta/amber (soil) |
| `--chart-3` | `oklch(0.55 0.18 255)` | sky/water blue (irrigation) |
| `--chart-4` | `oklch(0.62 0.17 330)` | berry magenta (the berry row) |
| `--chart-5` | `oklch(0.75 0.15 95)` | golden yellow (harvest/sun) |

### Dark (`.dark`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.16 0.014 145)` | |
| `--foreground` | `oklch(0.96 0.01 95)` | |
| `--card` | `oklch(0.21 0.016 145)` | |
| `--card-foreground` | `oklch(0.96 0.01 95)` | |
| `--primary` | `oklch(0.72 0.14 142)` | brighter leaf green pops on dark |
| `--primary-foreground` | `oklch(0.16 0.03 145)` | |
| `--secondary` | `oklch(0.27 0.02 145)` | |
| `--secondary-foreground` | `oklch(0.94 0.01 95)` | |
| `--muted` | `oklch(0.25 0.016 145)` | |
| `--muted-foreground` | `oklch(0.68 0.02 100)` | |
| `--accent` | `oklch(0.32 0.06 85)` | |
| `--accent-foreground` | `oklch(0.94 0.03 85)` | |
| `--destructive` | `oklch(0.704 0.191 25)` | |
| `--destructive-foreground` | `oklch(0.15 0.02 25)` | |
| `--border` | `oklch(1 0 0 / 12%)` | |
| `--input` | `oklch(1 0 0 / 16%)` | |
| `--ring` | `oklch(0.65 0.12 142)` | |
| `--chart-1` | `oklch(0.68 0.15 142)` | |
| `--chart-2` | `oklch(0.72 0.15 55)` | |
| `--chart-3` | `oklch(0.68 0.16 255)` | |
| `--chart-4` | `oklch(0.70 0.17 330)` | |
| `--chart-5` | `oklch(0.80 0.14 95)` | |

### Supplementary tokens (Scheme 1)

| Token | Light | Dark |
|---|---|---|
| `--popover` | `oklch(0.995 0.003 95)` | `oklch(0.21 0.016 145)` |
| `--popover-foreground` | `oklch(0.18 0.02 145)` | `oklch(0.96 0.01 95)` |
| `--sidebar` | `oklch(0.97 0.008 95)` | `oklch(0.19 0.015 145)` |
| `--sidebar-foreground` | `oklch(0.18 0.02 145)` | `oklch(0.96 0.01 95)` |
| `--sidebar-primary` | `oklch(0.48 0.11 142)` | `oklch(0.72 0.14 142)` |
| `--sidebar-primary-foreground` | `oklch(0.98 0.01 145)` | `oklch(0.16 0.03 145)` |
| `--sidebar-accent` | `oklch(0.95 0.02 130)` | `oklch(0.27 0.02 145)` |
| `--sidebar-accent-foreground` | `oklch(0.28 0.04 145)` | `oklch(0.94 0.01 95)` |
| `--sidebar-border` | `oklch(0.90 0.015 100)` | `oklch(1 0 0 / 12%)` |
| `--sidebar-ring` | `oklch(0.55 0.10 142)` | `oklch(0.65 0.12 142)` |

---

## Scheme 2 — Terracotta & Clay

**Feel:** warm-forward and tactile — clay pots, sun-baked soil, dry
midsummer light. Primary moves to a burnt-orange terracotta; green survives
only as `--secondary` and one chart color, so the app no longer reads as
"the green app" at a glance even though the underlying identity (garden
materials) is the same one the icon draws from. This is the most visually
distinct of the three from the current default.

### Light (`:root`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.98 0.008 70)` | warm ivory/sand |
| `--foreground` | `oklch(0.22 0.02 40)` | deep umber-black |
| `--card` | `oklch(0.995 0.006 70)` | |
| `--card-foreground` | `oklch(0.22 0.02 40)` | |
| `--primary` | `oklch(0.52 0.16 45)` | terracotta clay-pot orange |
| `--primary-foreground` | `oklch(0.98 0.01 45)` | |
| `--secondary` | `oklch(0.93 0.03 140)` | pale sage (green demoted here) |
| `--secondary-foreground` | `oklch(0.30 0.05 145)` | |
| `--muted` | `oklch(0.94 0.02 70)` | warm putty |
| `--muted-foreground` | `oklch(0.48 0.03 55)` | |
| `--accent` | `oklch(0.90 0.06 45)` | light terracotta tint |
| `--accent-foreground` | `oklch(0.30 0.08 40)` | |
| `--destructive` | `oklch(0.56 0.23 25)` | |
| `--destructive-foreground` | `oklch(0.98 0.01 25)` | |
| `--border` | `oklch(0.88 0.02 60)` | |
| `--input` | `oklch(0.88 0.02 60)` | |
| `--ring` | `oklch(0.58 0.15 45)` | |
| `--chart-1` | `oklch(0.58 0.17 45)` | terracotta (primary family) |
| `--chart-2` | `oklch(0.52 0.12 142)` | garden green |
| `--chart-3` | `oklch(0.55 0.16 255)` | irrigation blue |
| `--chart-4` | `oklch(0.62 0.14 300)` | violet (flowering crops) |
| `--chart-5` | `oklch(0.78 0.14 95)` | golden straw |

### Dark (`.dark`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.17 0.012 40)` | near-black warm umber |
| `--foreground` | `oklch(0.96 0.01 70)` | |
| `--card` | `oklch(0.22 0.015 45)` | |
| `--card-foreground` | `oklch(0.96 0.01 70)` | |
| `--primary` | `oklch(0.68 0.17 42)` | glowing terracotta |
| `--primary-foreground` | `oklch(0.16 0.02 40)` | |
| `--secondary` | `oklch(0.28 0.03 145)` | deep sage |
| `--secondary-foreground` | `oklch(0.92 0.02 130)` | |
| `--muted` | `oklch(0.26 0.015 50)` | |
| `--muted-foreground` | `oklch(0.68 0.02 60)` | |
| `--accent` | `oklch(0.32 0.06 45)` | |
| `--accent-foreground` | `oklch(0.93 0.03 45)` | |
| `--destructive` | `oklch(0.68 0.19 24)` | |
| `--destructive-foreground` | `oklch(0.15 0.02 24)` | |
| `--border` | `oklch(1 0 0 / 12%)` | |
| `--input` | `oklch(1 0 0 / 16%)` | |
| `--ring` | `oklch(0.66 0.15 42)` | |
| `--chart-1` | `oklch(0.70 0.17 45)` | |
| `--chart-2` | `oklch(0.66 0.14 142)` | |
| `--chart-3` | `oklch(0.68 0.16 255)` | |
| `--chart-4` | `oklch(0.70 0.15 300)` | |
| `--chart-5` | `oklch(0.82 0.13 95)` | |

### Supplementary tokens (Scheme 2)

| Token | Light | Dark |
|---|---|---|
| `--popover` | `oklch(0.995 0.006 70)` | `oklch(0.22 0.015 45)` |
| `--popover-foreground` | `oklch(0.22 0.02 40)` | `oklch(0.96 0.01 70)` |
| `--sidebar` | `oklch(0.96 0.012 70)` | `oklch(0.20 0.014 45)` |
| `--sidebar-foreground` | `oklch(0.22 0.02 40)` | `oklch(0.96 0.01 70)` |
| `--sidebar-primary` | `oklch(0.52 0.16 45)` | `oklch(0.68 0.17 42)` |
| `--sidebar-primary-foreground` | `oklch(0.98 0.01 45)` | `oklch(0.16 0.02 40)` |
| `--sidebar-accent` | `oklch(0.93 0.03 140)` | `oklch(0.28 0.03 145)` |
| `--sidebar-accent-foreground` | `oklch(0.30 0.05 145)` | `oklch(0.92 0.02 130)` |
| `--sidebar-border` | `oklch(0.88 0.02 60)` | `oklch(1 0 0 / 12%)` |
| `--sidebar-ring` | `oklch(0.58 0.15 45)` | `oklch(0.66 0.15 42)` |

---

## Scheme 3 — Botanical Slate

**Feel:** cool, moody, editorial. Deep, saturated moss/forest green
(darker and more saturated than the icon's own green) sits on cool
slate-blue neutrals rather than warm ones, with a "greenhouse glass"
teal used for accent surfaces. This is the direction that reads best if
the app ever defaults to dark mode — it's designed dark-forward, with the
light mode as the secondary variant rather than the other way around.

### Light (`:root`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.97 0.006 200)` | cool pale slate-white |
| `--foreground` | `oklch(0.20 0.02 220)` | deep slate-charcoal |
| `--card` | `oklch(0.995 0.004 200)` | |
| `--card-foreground` | `oklch(0.20 0.02 220)` | |
| `--primary` | `oklch(0.40 0.13 155)` | deep moss/forest green |
| `--primary-foreground` | `oklch(0.97 0.01 155)` | |
| `--secondary` | `oklch(0.92 0.02 220)` | cool pale slate-blue |
| `--secondary-foreground` | `oklch(0.26 0.03 220)` | |
| `--muted` | `oklch(0.93 0.01 210)` | |
| `--muted-foreground` | `oklch(0.46 0.02 215)` | |
| `--accent` | `oklch(0.85 0.07 195)` | glasshouse teal tint |
| `--accent-foreground` | `oklch(0.24 0.06 195)` | |
| `--destructive` | `oklch(0.55 0.22 25)` | |
| `--destructive-foreground` | `oklch(0.98 0.01 25)` | |
| `--border` | `oklch(0.88 0.012 210)` | |
| `--input` | `oklch(0.88 0.012 210)` | |
| `--ring` | `oklch(0.50 0.11 155)` | |
| `--chart-1` | `oklch(0.46 0.13 155)` | forest green (primary family) |
| `--chart-2` | `oklch(0.55 0.15 195)` | glasshouse teal |
| `--chart-3` | `oklch(0.58 0.17 30)` | rust/copper (tools, autumn) |
| `--chart-4` | `oklch(0.55 0.16 300)` | violet (dusk/lavender) |
| `--chart-5` | `oklch(0.70 0.14 90)` | mustard/harvest gold |

### Dark (`.dark`)

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.15 0.012 220)` | near-black slate |
| `--foreground` | `oklch(0.95 0.008 200)` | |
| `--card` | `oklch(0.20 0.015 215)` | |
| `--card-foreground` | `oklch(0.95 0.008 200)` | |
| `--primary` | `oklch(0.62 0.15 155)` | glowing moss green |
| `--primary-foreground` | `oklch(0.14 0.02 155)` | |
| `--secondary` | `oklch(0.26 0.02 215)` | |
| `--secondary-foreground` | `oklch(0.92 0.01 200)` | |
| `--muted` | `oklch(0.24 0.014 215)` | |
| `--muted-foreground` | `oklch(0.65 0.02 205)` | |
| `--accent` | `oklch(0.32 0.05 195)` | deep teal accent bg |
| `--accent-foreground` | `oklch(0.90 0.05 195)` | |
| `--destructive` | `oklch(0.66 0.20 23)` | |
| `--destructive-foreground` | `oklch(0.14 0.02 23)` | |
| `--border` | `oklch(1 0 0 / 10%)` | |
| `--input` | `oklch(1 0 0 / 14%)` | |
| `--ring` | `oklch(0.58 0.13 155)` | |
| `--chart-1` | `oklch(0.62 0.15 155)` | |
| `--chart-2` | `oklch(0.66 0.15 195)` | |
| `--chart-3` | `oklch(0.66 0.17 32)` | |
| `--chart-4` | `oklch(0.66 0.16 300)` | |
| `--chart-5` | `oklch(0.78 0.13 90)` | |

### Supplementary tokens (Scheme 3)

| Token | Light | Dark |
|---|---|---|
| `--popover` | `oklch(0.995 0.004 200)` | `oklch(0.20 0.015 215)` |
| `--popover-foreground` | `oklch(0.20 0.02 220)` | `oklch(0.95 0.008 200)` |
| `--sidebar` | `oklch(0.955 0.008 210)` | `oklch(0.18 0.014 215)` |
| `--sidebar-foreground` | `oklch(0.20 0.02 220)` | `oklch(0.95 0.008 200)` |
| `--sidebar-primary` | `oklch(0.40 0.13 155)` | `oklch(0.62 0.15 155)` |
| `--sidebar-primary-foreground` | `oklch(0.97 0.01 155)` | `oklch(0.14 0.02 155)` |
| `--sidebar-accent` | `oklch(0.92 0.02 220)` | `oklch(0.26 0.02 215)` |
| `--sidebar-accent-foreground` | `oklch(0.26 0.03 220)` | `oklch(0.92 0.01 200)` |
| `--sidebar-border` | `oklch(0.88 0.012 210)` | `oklch(1 0 0 / 10%)` |
| `--sidebar-ring` | `oklch(0.50 0.11 155)` | `oklch(0.58 0.13 155)` |

---

## Chart palette notes (all three schemes)

`--chart-1` through `--chart-5` are what issue #182's Gantt-view period bars
(and any future categorical chart — harvest yield by crop family, bed
utilization, etc.) will pull from. In every scheme above, the five hues are
spread across the color wheel (roughly 40–110° apart) and also vary in
lightness/chroma, not just hue, so they stay distinguishable even for
readers with common red-green color vision deficiencies and don't collapse
into "five greens." `--chart-1` is always drawn from the scheme's own
primary family, so a chart legend still visually agrees with the rest of
the UI; `--chart-2`…`--chart-5` intentionally range further out (blue,
violet, gold, rust, teal, magenta depending on scheme) since their whole
job is to be tell-apart-able from each other, not to match the brand.

## Applying a chosen scheme

Not done here — this is a proposal, and `ui-ux-designer` has no write access
to `frontend/` and no commit authority regardless. Whichever scheme (or
scheme, per-token remix) the user picks, the implementation is a
`frontend-developer` ticket: replace the corresponding custom properties in
`frontend/src/index.css`'s `:root` and `.dark` blocks with the table above.
Two small cleanup notes for whoever picks this up:

- The current file declares `--border` and `--accent` once near the top of
  `:root` (right after the `font:`/`letter-spacing` declarations) and then
  never reassigns them again lower in the same block — that's not a
  conflict today since nothing collides, but a straight token swap should
  consolidate all color tokens into one block (order doesn't matter to CSS,
  but a single visually-grouped block is easier to audit against a spec
  like this one).
- `--destructive-foreground` isn't currently defined in either `:root` or
  `.dark` in the shipped file (only `--destructive` is) — this spec defines
  it explicitly for both modes in all three schemes; make sure it actually
  gets added, not silently dropped, since anything currently rendering
  destructive-colored text/icons is presumably falling back to plain
  `--foreground` today, which may or may not have been intentional.

No ticket has been filed yet for the actual token swap — that's deliberate,
since it depends on the user picking a direction (or asking for a remix)
first rather than `ui-ux-designer` guessing which one to hand off.
