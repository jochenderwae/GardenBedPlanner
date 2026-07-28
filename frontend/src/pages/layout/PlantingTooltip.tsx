/** Shared hover-tooltip primitive for anything on the canvas that reports
 * its own hover state up to `Layout.tsx` (bed/garden name labels truncated
 * by #166's width clamp, planting markers, rotation-warning triangles, the
 * View tab's read-only snapshot markers) - plain HTML rendered as a sibling
 * of whichever Konva `<Stage>` is currently mounted, since Konva has no HTML
 * text layer of its own. Pulled out of the old `ExampleGardenView.tsx` (its
 * original, narrower home) once the View tab stopped being the only
 * hover-tooltip consumer - see #180. */
export interface PlantingTooltipState {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

export function PlantingTooltip({ tooltip }: { tooltip: PlantingTooltipState | null }) {
  if (!tooltip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
    >
      <div className="font-medium">{tooltip.title}</div>
      {tooltip.subtitle && <div className="text-muted-foreground italic">{tooltip.subtitle}</div>}
    </div>
  );
}
