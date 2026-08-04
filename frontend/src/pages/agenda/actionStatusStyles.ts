import type { ActionStatus } from "@/api/client";

/** Shared `ActionStatus` -> visual-style mapping for `CalendarView` (#29)'s
 * Month/Week/Day cells - the same 3-state language `timeline/timelineColors.ts`'s
 * `ACTION_STATUS_DIAMOND_CLASS` already defines for Timeline's Gantt-row
 * diamonds, re-expressed as pills/dots/rows instead (a calendar grid has no
 * bar to layer a diamond over). Status is never conveyed by color alone -
 * completed also gets a check glyph, skipped also gets `line-through` - so
 * this stays legible without relying on hue discrimination. Kept as its own
 * module (not folded into `taskAgenda.ts`) since it's pure Tailwind class
 * data, not task-shaping logic. */

/** Desktop Month view's status-colored pills, and Week/Day's full task
 * rows. */
export const ACTION_STATUS_PILL_CLASS: Record<ActionStatus, string> = {
  pending: "border border-muted-foreground/40 bg-background text-foreground",
  completed: "border border-transparent bg-primary text-primary-foreground",
  skipped: "border border-muted-foreground/30 bg-muted text-muted-foreground line-through",
};

/** Mobile Month view's compact status dots (no room for label text). */
export const ACTION_STATUS_DOT_CLASS: Record<ActionStatus, string> = {
  pending: "border-2 border-muted-foreground bg-background",
  completed: "border-2 border-primary bg-primary",
  skipped: "border border-muted-foreground/40 bg-muted opacity-60",
};

/** A short glyph prefix reinforcing status beyond color/pill style alone -
 * "done" and "struck out" read clearly even in a squinting-at-a-phone
 * glance. Pending gets no glyph (the unmarked, default state). */
export const ACTION_STATUS_GLYPH: Record<ActionStatus, string> = {
  pending: "",
  completed: "✓ ",
  skipped: "",
};
