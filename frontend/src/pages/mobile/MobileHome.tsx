import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MobileHome() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>GardenBedPlanner</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          The simplified mobile view - for quick logging, your agenda, and notifications. The full bed-layout
          editor lives on desktop.
        </p>
      </CardContent>
    </Card>
  );
}
