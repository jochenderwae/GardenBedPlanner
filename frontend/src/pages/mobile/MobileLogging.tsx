import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder until harvest and compost/fertilization logging forms exist
 * on the frontend (their backend models are still being built out - see the
 * "Harvest log model + API" and "CompostFertilizationLog model + API"
 * backlog items) - this route/tab exists now so the mobile shell's
 * navigation is complete, even though the forms behind it aren't yet. */
export function MobileLogging() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logging</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Coming soon - quick harvest and compost/fertilization logging forms.
        </p>
      </CardContent>
    </Card>
  );
}
