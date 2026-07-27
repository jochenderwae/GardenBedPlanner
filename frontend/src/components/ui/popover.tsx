import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

/** Popover wrapper around Base UI's `Popover` primitive (already a
 * dependency via `@base-ui/react`, same library `Dialog`/`Tooltip` already
 * come from in this codebase) - for a collapsed trigger that expands into
 * arbitrary interactive content (a checkbox group, a list, ...) anchored to
 * it. Closes on outside-click, Escape, or selecting elsewhere with no
 * custom wiring needed - Base UI's `Root` handles all three itself (see the
 * "Edible parts" dropdown/multi-select backlog item, its first real
 * caller). Deliberately minimal, matching `dialog.tsx`'s own thin-wrapper
 * style - just enough chrome (positioning, a card-like popup) for callers
 * to drop their existing content into. */
function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger({ className, ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" className={className} {...props} />;
}

function PopoverPortal(props: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal {...props} />;
}

function PopoverPopup({
  className,
  children,
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props & { sideOffset?: number }) {
  return (
    <PopoverPortal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          data-slot="popover-popup"
          className={cn("z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none", className)}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  );
}

export { Popover, PopoverTrigger, PopoverPortal, PopoverPopup };
