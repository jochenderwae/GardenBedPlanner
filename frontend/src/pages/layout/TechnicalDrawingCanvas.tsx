import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Stage } from "react-konva";
import { getBed, listPlantings, listPlants } from "@/api/client";
import { boundingRect } from "@/pages/layout/geometry";
import { isPlantingActiveAsOf, todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { PlantingTooltip, type PlantingTooltipState } from "@/pages/layout/PlantingTooltip";
import { TechnicalDrawingLayer } from "@/pages/layout/TechnicalDrawingLayer";
import { useContainerSize } from "@/pages/layout/useContainerSize";
import { fitViewport } from "@/pages/layout/viewport";

/** Extra room (cm, on every side) beyond the bed's own footprint so a
 * dimension line/label right up against the bed's edge isn't clipped by
 * `fitViewport`'s tight bounding box. Same margin `TechnicalDrawing.tsx`'s
 * standalone page used before this component was factored out of it. */
const DRAWING_MARGIN_CM = 40;

/** #193's read-only, bed-relative annotated drawing (`TechnicalDrawingLayer`
 * + `PlantingTooltip`, fit-to-viewport) as a self-contained, embeddable
 * canvas - no page chrome (header/back button), just the `Stage` and its
 * sizing/data-fetching. Shared by the standalone `/layout/beds/:bedId/
 * technical-drawing` page (`TechnicalDrawing.tsx`) and #246's inline
 * embed on `TaskDetail.tsx`, desktop and mobile alike - the drawing itself
 * is read-only annotation, not the drag/drop canvas editor, so reusing it
 * scaled to a narrower container is deliberate reuse here, not the "Konva
 * editor squeezed onto a phone" case CLAUDE.md's mobile convention warns
 * against.
 *
 * `heightClassName` lets callers control how tall the canvas renders (a
 * fixed height inline in a card vs. `flex-1` filling the standalone page) -
 * `useContainerSize` measures whatever that ends up being. */
export function TechnicalDrawingCanvas({ bedId, heightClassName = "h-80" }: { bedId: number; heightClassName?: string }) {
  const [tooltip, setTooltip] = useState<PlantingTooltipState | null>(null);
  const { ref: canvasContainerRef, size: canvasSize } = useContainerSize({ width: 400, height: 320 });

  const bedQuery = useQuery({
    queryKey: ["bed", bedId],
    queryFn: () => getBed(bedId),
    enabled: Number.isFinite(bedId),
  });
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });

  const plantsBySlug = useMemo(() => {
    const map = new Map(plantsQuery.data?.map((p) => [p.slug, p]));
    return map;
  }, [plantsQuery.data]);

  const today = todayIsoDate();
  const bedPlantings = (plantingsQuery.data ?? []).filter(
    (p) => p.bed_id === bedId && isPlantingActiveAsOf(p, today),
  );

  const viewport = useMemo(() => {
    if (!bedQuery.data) return undefined;
    const bedRect = boundingRect(bedQuery.data.border_geometry);
    const box = { x: -DRAWING_MARGIN_CM, y: -DRAWING_MARGIN_CM, width: bedRect.width + DRAWING_MARGIN_CM * 2, height: bedRect.height + DRAWING_MARGIN_CM * 2 };
    return fitViewport([box], canvasSize);
  }, [bedQuery.data, canvasSize]);

  const isPending = bedQuery.isPending || plantingsQuery.isPending || plantsQuery.isPending;
  const isError = bedQuery.isError || plantingsQuery.isError || plantsQuery.isError;

  if (isPending) return <p className="text-sm text-muted-foreground">Loading drawing…</p>;
  if (isError) return <p className="text-sm text-destructive">Failed to load this bed's technical drawing.</p>;
  if (!bedQuery.data || !viewport) return <p className="text-sm text-destructive">No bed found for this id.</p>;

  return (
    <div ref={canvasContainerRef} className={`relative min-h-0 min-w-0 w-full overflow-hidden rounded-md border bg-white ${heightClassName}`}>
      <Stage width={canvasSize.width} height={canvasSize.height} x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
        <TechnicalDrawingLayer bed={bedQuery.data} plantings={bedPlantings} plantsBySlug={plantsBySlug} onHover={setTooltip} viewport={viewport} />
      </Stage>
      <PlantingTooltip tooltip={tooltip} />
    </div>
  );
}
