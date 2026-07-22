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

export { Dialog, DialogPortal, DialogBackdrop, DialogPopup, DialogTitle, DialogClose };
