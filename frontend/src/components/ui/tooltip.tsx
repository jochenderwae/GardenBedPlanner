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
 * keyboard wiring needed. `content` is plain text (every current caller's
 * help text is a plain description string), not arbitrary children. */
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
 * fields vs. table column headers) to share a single wrapper. */
export function FieldHint({ description }: { description?: string | null }) {
  if (!description) return null;
  return (
    <Tooltip content={description}>
      <Info className="size-3.5 shrink-0 text-muted-foreground" />
    </Tooltip>
  );
}
