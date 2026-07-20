import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/** Confirmation-dialog wrapper around Base UI's `AlertDialog` primitive
 * (already a dependency via `@base-ui/react`, same library `button.tsx`
 * wraps) - the frontend toolkit's own dialog component, replacing bare
 * browser `confirm()` popups. Deliberately one shared component for every
 * "are you sure" prompt in the editor (shape-switch point loss, bed
 * deletion, ...) rather than a one-off per call site. */
function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root {...props} />;
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal {...props} />;
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-backdrop"
      className={cn("fixed inset-0 z-50 bg-black/50 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0", className)}
      {...props}
    />
  );
}

function AlertDialogPopup({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPortal>
      <AlertDialogBackdrop />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <AlertDialogPrimitive.Popup
          data-slot="alert-dialog-popup"
          className={cn(
            "w-full max-w-sm rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Popup>
      </div>
    </AlertDialogPortal>
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("text-sm font-medium", className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("mt-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}

/** The dismissing/"keep things as they are" action - closes without
 * running any mutation. */
function AlertDialogCancel({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
      {...props}
    />
  );
}

/** The confirming/"go ahead" action - still just a `Dialog.Close` under
 * the hood (closes on click same as Cancel), but callers pass their own
 * `onClick` to run the actual mutation alongside the close. */
function AlertDialogAction({
  className,
  variant = "default",
  ...props
}: AlertDialogPrimitive.Close.Props & { variant?: "default" | "destructive" }) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant, size: "sm" }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
};
