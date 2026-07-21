import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder until the calendar-of-planting-derived-actions view (see the
 * "Calendar view of planting-derived actions" backlog item) is built - this
 * route/tab exists now so the mobile shell's navigation is complete, even
 * though the feature behind it isn't yet. */
export function MobileAgenda() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agenda</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Coming soon - a calendar view of upcoming planting-derived actions and seed-buying reminders.
        </p>
      </CardContent>
    </Card>
  );
}
