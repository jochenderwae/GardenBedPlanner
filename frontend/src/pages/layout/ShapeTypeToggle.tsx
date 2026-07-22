import { useState } from "react";
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
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import { polygonToRectangle, rectangleToPolygon } from "./geometry";

interface ShapeTypeToggleProps {
  geometry: Geometry;
  onChange: (geometry: Geometry) => void;
}

const SHAPE_TYPE_OPTIONS = [
  { value: "rectangle" as const, label: "Rectangle" },
  { value: "polygon" as const, label: "Polygon" },
];

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

  function handleSelect(next: "rectangle" | "polygon") {
    if (next === geometry.type) return;
    if (next === "rectangle") {
      setConfirmOpen(true);
    } else if (geometry.type === "rectangle") {
      onChange(rectangleToPolygon(geometry));
    }
  }

  return (
    <>
      <RadioToggleGroup
        ariaLabel="Shape type"
        value={geometry.type}
        onChange={handleSelect}
        options={SHAPE_TYPE_OPTIONS}
        fill
      />

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
