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
// #216: confirmed against Base UI's own docs (`docs/react/components/
// tooltip.md`, bundled in `node_modules/@base-ui/react`) and the real
// rendered DOM (see `e2e/field-hint-tooltip-coverage.spec.ts`'s own note,
// written independently and reaching the same conclusion) - `Tooltip.Popup`
// deliberately carries neither `role="tooltip"` nor an `aria-describedby`
// link back to its trigger, on this version of the library. This isn't a
// missed wiring step in this file's own composition of the primitive - Base
// UI's docs are explicit that `Tooltip` is a visual-only affordance for
// sighted mouse/keyboard users ("Tooltips alone are not accessible to touch
// or screen reader users") and that the documented mitigation is giving the
// *trigger* its own real accessible name via `aria-label` that echoes the
// tooltip content, not wiring up a screen-reader-announced popup
// relationship the primitive doesn't support. That's deliberately NOT done
// generically here for every `Tooltip` caller, though - most of this file's
// callers (Toolbar's icon buttons, `equipmentCondition.tsx`'s "Unplace"
// button, `TaskDiamond`, ...) already carry their own correct, more
// specific accessible name (visible button text or an explicit `aria-label`
// of their own) that's a better screen-reader label for that control than
// this tooltip's supplementary hint text would be - forcing `aria-label=
// content` on every trigger would silently clobber those. `FieldHint` is
// the one caller genuinely missing any accessible name at all (see its own
// doc below), so that's where this ticket's actual fix lives.
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
 * (still purely decorative - the `<button>` is what's focusable). A plain,
 * unstyled-looking button (no visible button chrome) rather than a
 * `<span tabIndex={0}>` - nesting an interactive `<button>` inside this
 * app's existing `<label>`/`<th>` call sites is valid HTML (neither is
 * itself a single-purpose interactive control), and a real button gets
 * standard keyboard activation (Enter/Space) semantics for free that a
 * plain focusable `<span>` doesn't.
 *
 * #216: the button previously had no accessible name at all - no visible
 * text, an `aria-hidden` icon as its only child, and (per `Tooltip`'s own
 * doc above) no `aria-describedby` link to the tooltip popup either, so a
 * screen reader announced it as a bare, unlabeled "button" and the
 * `description` text it exists to surface was completely unreachable
 * without sight. `aria-label={description}` below is the fix Base UI's own
 * docs prescribe for exactly this shape of trigger (an icon-only control
 * whose sole purpose is showing this tooltip) - safe to apply unlike a
 * generic `Tooltip`-level fix would be, since this button never has any
 * other accessible name of its own to clobber. */
export function FieldHint({ description }: { description?: string | null }) {
  if (!description) return null;
  return (
    <Tooltip content={description}>
      <button
        type="button"
        aria-label={description}
        className="inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
