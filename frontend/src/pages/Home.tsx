import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHealth } from "@/api/client";

export function Home() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
  });

  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>GardenBedPlanner</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <p>Checking backend…</p>}
          {isError && <p>Backend unreachable</p>}
          {data && <p>API status: {data.status}</p>}
        </CardContent>
      </Card>
      <Link to="/layout" className={buttonVariants()}>
        Open bed layout
      </Link>
    </div>
  );
}
