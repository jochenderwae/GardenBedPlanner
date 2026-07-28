import type { ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Info } from "lucide-react";

/** Accessible tooltip wrapper around Base UI's `Tooltip` primitive (already
 * a dependency via `@base-ui/react`, same library `Dialog`/`AlertDialog`
 * already come from in this codebase) - replaces the native `title`
 * attribute used throughout the app for field-level help text, which is
 * neither reliably keyboard-accessible (most browsers only show `title` on
 * mouse hover) nor touch-accessible (no hover state on a touchscreen). Opens
 * on both hover *and* focus by default, closing that gap with no custom
 * keyboard wiring needed - *given* `children` is a real interactive/
 * focusable host element (see `FieldHint`'s own doc for what goes wrong
 * otherwise). `content` is plain text (every current caller's help text is
 * a plain description string), not arbitrary children.
 *
 * The "opens on focus" half is gated on the real CSS `:focus-visible`
 * match (`floating-ui-react`'s `useFocus` checks `target.matches(":focus-
 * visible")` directly, not just "is this element focused") - i.e. genuine
 * keyboard navigation (Tab), not a mouse click that happens to focus the
 * element too, matching this app's other focus-ring styling elsewhere. A
 * real consequence worth knowing if you're testing this: a programmatic
 * `element.focus()` call only satisfies `:focus-visible` when nothing
 * establishing "mouse modality" (a real click/pointerdown) preceded it in
 * the same page session - e.g. `.focus()` right after page load opens the
 * tooltip, but `.focus()` right after a mouse click elsewhere on the page
 * doesn't, even though the element genuinely has DOM focus either way. A
 * real Tab keypress always re-arms keyboard modality and opens it
 * correctly regardless of what came before - this is standard browser
 * `:focus-visible` behavior working as intended, not a bug in this
 * component. */
export function Tooltip({ content, children }: { content: string; children: ReactElement }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner sideOffset={4}>
          <TooltipPrimitive.Popup className="max-w-64 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** The small Info-icon + `Tooltip` affordance shared by every field
 * label/column heading across the app that used to carry its help text as a
 * bare `title` attribute (giving no visual signal a tooltip even existed -
 * see the "replace title= attribute tooltips" backlog item). Renders
 * nothing for a missing/empty description, matching how not every field
 * this replaces actually has one documented. Deliberately just the
 * icon+tooltip, not the label text itself - callers keep their own label
 * markup (`<span>`, `<th>`, ...) exactly as it was and drop this in next to
 * it, since that markup/styling varies too much across call sites (plain
 * fields vs. table column headers) to share a single wrapper.
 *
 * The `<Info>` icon is wrapped in a real `<button type="button">` rather
 * than being `Tooltip`'s trigger directly - `Tooltip.Trigger`'s
 * `render={children}` only merges its own interaction props onto whatever
 * element `children` already is, it doesn't make that element focusable on
 * its own. A bare `<Info>` renders as an `<svg>` with no `tabindex` at all
 * and lucide's own default `aria-hidden="true"`, so it was silently
 * unreachable by Tab and invisible to screen readers regardless - a real,
 * confirmed bug the tester found on this exact ticket, not a hypothetical
 * (see `frontend/e2e/accessible-tooltips.spec.ts`). A native `<button>`
 * (matching the pattern this file's other `Tooltip` call sites already use,
 * e.g. Toolbar's icon buttons) is natively focusable and keyboard-
 * activatable for free, verified via a real Tab-key-only path - see this
 * file's own `Tooltip` doc above for the `:focus-visible` nuance that can
 * make a test using a *programmatic* `.focus()` call (rather than a real
 * Tab keypress) misreport this as still broken depending on what happened
 * on the page immediately before. The icon itself stays `aria-hidden`
 * (still purely decorative - the `<button>` is what's focusable and carries
 * the tooltip's `aria-describedby` via `Tooltip.Trigger`'s merged props). A
 * plain, unstyled-looking button (no visible button chrome) rather than a
 * `<span tabIndex={0}>` - nesting an interactive `<button>` inside this
 * app's existing `<label>`/`<th>` call sites is valid HTML (neither is
 * itself a single-purpose interactive control), and a real button gets
 * standard keyboard activation (Enter/Space) semantics for free that a
 * plain focusable `<span>` doesn't. */
export function FieldHint({ description }: { description?: string | null }) {
  if (!description) return null;
  return (
    <Tooltip content={description}>
      <button
        type="button"
        className="inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
