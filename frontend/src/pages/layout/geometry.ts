import type { BedType } from "@/api/client";

/** 1cm = 1px - real bed sizes (30-200cm) map directly to a readable canvas
 * scale without needing zoom/pan for a first pass. Revisit if/when gardens
 * with a much larger total footprint make this too small or the canvas too
 * large to be usable. */
export const CM_TO_PX = 1;

export const CANVAS_WIDTH_PX = 1400;
export const CANVAS_HEIGHT_PX = 900;
export const GRID_SPACING_CM = 50;
export const DRAG_SNAP_CM = 10;

export function snapToGrid(value: number, gridSizeCm: number = DRAG_SNAP_CM): number {
  return Math.round(value / gridSizeCm) * gridSizeCm;
}

export const BED_TYPE_COLORS: Record<BedType, { fill: string; stroke: string }> = {
  large_planter: { fill: "#c7dfc5", stroke: "#5b8c5a" },
  small_planter: { fill: "#bfe3e0", stroke: "#3f8f8a" },
  berry_row: { fill: "#e8c6d8", stroke: "#a5477e" },
  compost_bin: { fill: "#dccab0", stroke: "#8a6a3e" },
  fruit_tree: { fill: "#cfe0b8", stroke: "#5f7a35" },
};

export const BED_TYPE_LABELS: Record<BedType, string> = {
  large_planter: "Large planter",
  small_planter: "Small planter",
  berry_row: "Berry row",
  compost_bin: "Compost bin",
  fruit_tree: "Fruit tree",
};
