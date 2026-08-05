import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { getBed } from "@/api/client";
import { TechnicalDrawingCanvas } from "@/pages/layout/TechnicalDrawingCanvas";

/** #193's "technical drawing" - a read-only, bed-relative annotated view of
 * one bed's plantings, reached by bed id (`/layout/beds/:bedId/technical-
 * drawing`). Not yet linked from a task/agenda entry point (#181/#182,
 * neither shipped yet) - reachable today via a "View technical drawing"
 * link on that bed's `BedPanel` in the Edit tab, per this ticket's own note
 * that it "needs a real place to link from before it's reachable," ahead of
 * the eventual task-scoped entry point.
 *
 * The actual canvas (`Stage` + `TechnicalDrawingLayer` + data fetching) now
 * lives in `TechnicalDrawingCanvas` (#246) so #246's inline embed on
 * `TaskDetail.tsx` can reuse it without this page's own header/back
 * button - this component is just that page chrome. */
export function TechnicalDrawing() {
  const { bedId } = useParams();
  const bedIdNum = Number(bedId);

  const bedQuery = useQuery({
    queryKey: ["bed", bedIdNum],
    queryFn: () => getBed(bedIdNum),
    enabled: Number.isFinite(bedIdNum),
  });

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

      {Number.isFinite(bedIdNum) && <TechnicalDrawingCanvas bedId={bedIdNum} heightClassName="flex-1" />}
    </div>
  );
}
