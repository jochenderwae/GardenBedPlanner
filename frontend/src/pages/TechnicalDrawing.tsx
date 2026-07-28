import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Stage } from "react-konva";
import { buttonVariants } from "@/components/ui/button";
import { getBed, listPlantings, listPlants } from "@/api/client";
import { boundingRect } from "@/pages/layout/geometry";
import { isPlantingActiveAsOf, todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { PlantingTooltip, type PlantingTooltipState } from "@/pages/layout/PlantingTooltip";
import { TechnicalDrawingLayer } from "@/pages/layout/TechnicalDrawingLayer";
import { useContainerSize } from "@/pages/layout/useContainerSize";
import { fitViewport } from "@/pages/layout/viewport";

const CANVAS_FALLBACK_SIZE = { width: 900, height: 600 };
/** Extra room (cm, on every side) beyond the bed's own footprint so a
 * dimension line/label right up against the bed's edge isn't clipped by
 * `fitViewport`'s tight bounding box. */
const DRAWING_MARGIN_CM = 40;

/** #193's "technical drawing" - a read-only, bed-relative annotated view of
 * one bed's plantings, reached by bed id (`/layout/beds/:bedId/technical-
 * drawing`). Not yet linked from a task/agenda entry point (#181/#182,
 * neither shipped yet) - reachable today via a "View technical drawing"
 * link on that bed's `BedPanel` in the Edit tab, per this ticket's own note
 * that it "needs a real place to link from before it's reachable," ahead of
 * the eventual task-scoped entry point. */
export function TechnicalDrawing() {
  const { bedId } = useParams();
  const bedIdNum = Number(bedId);
  const [tooltip, setTooltip] = useState<PlantingTooltipState | null>(null);
  const { ref: canvasContainerRef, size: canvasSize } = useContainerSize(CANVAS_FALLBACK_SIZE);

  const bedQuery = useQuery({
    queryKey: ["bed", bedIdNum],
    queryFn: () => getBed(bedIdNum),
    enabled: Number.isFinite(bedIdNum),
  });
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });

  const plantsBySlug = useMemo(() => {
    const map = new Map(plantsQuery.data?.map((p) => [p.slug, p]));
    return map;
  }, [plantsQuery.data]);

  const today = todayIsoDate();
  const bedPlantings = (plantingsQuery.data ?? []).filter(
    (p) => p.bed_id === bedIdNum && isPlantingActiveAsOf(p, today),
  );

  const viewport = useMemo(() => {
    if (!bedQuery.data) return undefined;
    const bedRect = boundingRect(bedQuery.data.border_geometry);
    const box = { x: -DRAWING_MARGIN_CM, y: -DRAWING_MARGIN_CM, width: bedRect.width + DRAWING_MARGIN_CM * 2, height: bedRect.height + DRAWING_MARGIN_CM * 2 };
    return fitViewport([box], canvasSize);
  }, [bedQuery.data, canvasSize]);

  const isPending = bedQuery.isPending || plantingsQuery.isPending || plantsQuery.isPending;
  const isError = bedQuery.isError || plantingsQuery.isError || plantsQuery.isError;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <Link to="/layout" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
        <div>
          <h1 className="text-xl font-medium">Technical drawing</h1>
          {bedQuery.data && <p className="text-xs text-muted-foreground">{bedQuery.data.name} — distances shown are relative to this bed's own edges, not the garden.</p>}
        </div>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load this bed's technical drawing.</p>}
      {!isPending && !isError && !bedQuery.data && <p className="text-sm text-destructive">No bed found for this id.</p>}

      {bedQuery.data && viewport && (
        <div ref={canvasContainerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border bg-white">
          <Stage width={canvasSize.width} height={canvasSize.height} x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
            <TechnicalDrawingLayer bed={bedQuery.data} plantings={bedPlantings} plantsBySlug={plantsBySlug} onHover={setTooltip} viewport={viewport} />
          </Stage>
          <PlantingTooltip tooltip={tooltip} />
        </div>
      )}
    </div>
  );
}
