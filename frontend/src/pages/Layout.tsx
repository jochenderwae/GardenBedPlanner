import { Stage, Layer, Rect } from "react-konva";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";

export function Layout() {
  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
        <h1 className="text-xl font-medium">Bed layout</h1>
      </div>
      <div className="rounded-md border">
        <Stage width={800} height={600}>
          <Layer>
            <Rect
              x={20}
              y={20}
              width={160}
              height={160}
              fill="transparent"
              stroke="currentColor"
              dash={[4, 4]}
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
