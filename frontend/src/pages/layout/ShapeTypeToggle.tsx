import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Geometry } from "@/api/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { polygonToRectangle, rectangleToPolygon } from "./geometry";

interface ShapeTypeToggleProps {
  geometry: Geometry;
  onChange: (geometry: Geometry) => void;
}

/** Rectangle/Polygon switch reused wherever a Bed or Garden's border is set
 * up or edited. Rectangle is the default everywhere it's offered (per root
 * CLAUDE.md: "make the rectangle the default"); switching converts the
 * current shape's rough extent across rather than discarding it.
 * Polygon->Rectangle is lossy (`polygonToRectangle` collapses every vertex
 * down to a bounding box) so that direction confirms first via the shared
 * `AlertDialog` component - not a bare browser `confirm()`; Rectangle-
 * >Polygon is lossless (just re-expresses the same 4 corners as points)
 * and switches immediately, no confirmation needed. */
export function ShapeTypeToggle({ geometry, onChange }: ShapeTypeToggleProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex rounded-md border p-0.5 text-xs">
        <button
          type="button"
          className={cn(
            "flex-1 rounded px-2 py-1 font-medium",
            geometry.type === "rectangle" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
          onClick={() => geometry.type === "polygon" && setConfirmOpen(true)}
        >
          Rectangle
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded px-2 py-1 font-medium",
            geometry.type === "polygon" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
          onClick={() => geometry.type === "rectangle" && onChange(rectangleToPolygon(geometry))}
        >
          Polygon
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Switch to rectangle?</AlertDialogTitle>
          <AlertDialogDescription>
            Switching to a rectangle replaces the polygon with its bounding box - every point you've placed will be
            deleted. Do you want to continue?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>No - keep polygon</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => geometry.type === "polygon" && onChange(polygonToRectangle(geometry))}
            >
              Yes - delete points
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
