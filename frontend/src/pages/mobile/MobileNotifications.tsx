import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Placeholder until Web Push registration/delivery is fully wired up
 * end-to-end (backend half in progress - see the "Web Push notification
 * delivery" backlog item; the frontend subscribe flow itself is tracked by
 * the "PWA manifest + service worker" item) - this route/tab exists now so
 * the mobile shell's navigation is complete, and is the natural future home
 * for an "enable notifications" action once that flow lands. */
export function MobileNotifications() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Coming soon - enable push notifications and review reminders here.
        </p>
      </CardContent>
    </Card>
  );
}
