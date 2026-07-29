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
  /** A single line (most callers) or several (#174's warning/good-companion
   * icons, which can accumulate multiple simultaneous reasons - e.g. a
   * rotation conflict *and* a shade warning against the same neighbor) -
   * each array entry renders as its own line. */
  subtitle: string | string[];
}

export function PlantingTooltip({ tooltip }: { tooltip: PlantingTooltipState | null }) {
  if (!tooltip) return null;
  const lines = Array.isArray(tooltip.subtitle) ? tooltip.subtitle : tooltip.subtitle ? [tooltip.subtitle] : [];
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
    >
      <div className="font-medium">{tooltip.title}</div>
      {lines.map((line, i) => (
        <div key={i} className="text-muted-foreground italic">
          {line}
        </div>
      ))}
    </div>
  );
}
