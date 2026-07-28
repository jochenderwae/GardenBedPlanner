import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

/** Plain-dialog wrapper around Base UI's `Dialog` primitive (already a
 * dependency via `@base-ui/react`, same library `alert-dialog.tsx` wraps
 * and `NavDrawer.tsx` uses directly) - for arbitrary interactive content
 * with a close button (a `<form>` needing its own submit, unlike
 * `AlertDialog`'s fixed confirm/cancel shape). Deliberately unstyled
 * beyond centering/backdrop chrome so callers (`AddBedForm`, the
 * `AddPlantForm` in `PlantsDatabase.tsx`) keep their existing `Card`-based
 * visual chrome - this only supplies the semantics (focus trap,
 * Escape-to-close, `role="dialog"`/`aria-modal`, focus return) that a
 * hand-rolled `fixed inset-0` overlay div doesn't get for free. */
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal {...props} />;
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogPopup({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Popup data-slot="dialog-popup" className={cn("outline-none", className)} {...props}>
          {children}
        </DialogPrimitive.Popup>
      </div>
    </DialogPortal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={className} {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/** The button that opens the dialog - `render`-prop it onto an existing
 * styled `<Button>` (see `NavDrawer.tsx`'s identical pattern) rather than
 * rendering a second, differently-styled trigger. Not cosmetic: Base UI's
 * (and the underlying floating-ui-react's) automatic "return focus to
 * whatever opened this" behavior on close is keyed off the click
 * interaction registered via a real `Trigger` (see that library's own
 * `useClick`), not just "whatever `document.activeElement` happened to be"
 * - a dialog opened via a plain external button + a controlled `open` prop
 * (this component's own previous shape, before the "replace hand-rolled
 * overlays with Dialog" backlog item's own follow-up bug report) never
 * registers that reference, so focus silently stays on `<body>` after
 * Escape/close instead of returning to the button that opened it. */
function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export { Dialog, DialogPortal, DialogBackdrop, DialogPopup, DialogTitle, DialogClose, DialogTrigger };
