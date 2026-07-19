import { cn } from "@/lib/utils";
import type { Geometry } from "@/api/client";
import { polygonToRectangle, rectangleToPolygon } from "./geometry";

interface ShapeTypeToggleProps {
  geometry: Geometry;
  onChange: (geometry: Geometry) => void;
}

/** Rectangle/Polygon switch reused wherever a Bed or Garden's border is set
 * up or edited. Rectangle is the default everywhere it's offered (per root
 * CLAUDE.md: "make the rectangle the default"); switching converts the
 * current shape's rough extent across rather than discarding it. */
export function ShapeTypeToggle({ geometry, onChange }: ShapeTypeToggleProps) {
  return (
    <div className="flex rounded-md border p-0.5 text-xs">
      <button
        type="button"
        className={cn(
          "flex-1 rounded px-2 py-1 font-medium",
          geometry.type === "rectangle" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
        onClick={() => geometry.type === "polygon" && onChange(polygonToRectangle(geometry))}
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
  );
}
