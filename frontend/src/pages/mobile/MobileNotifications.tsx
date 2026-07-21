import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebPushSubscription } from "@/hooks/useWebPushSubscription";

const STATUS_MESSAGES: Record<string, string> = {
  unsupported: "This browser doesn't support push notifications.",
  subscribed: "Notifications are enabled on this device.",
  denied: "Notification permission was denied - enable it in your browser/device settings to try again.",
};

/** The one real piece of this tab so far - enabling Web Push (see #46's
 * backend delivery side and useWebPushSubscription). Reviewing/managing
 * individual reminders here is still coming, pending the agenda view (#29)
 * this would surface into. */
export function MobileNotifications() {
  const { status, error, subscribe } = useWebPushSubscription();
  const message = error ?? STATUS_MESSAGES[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Enable push notifications to get reminders for due actions on this device.
        </p>
        {status !== "unsupported" && status !== "subscribed" && (
          <Button size="sm" onClick={subscribe} disabled={status === "subscribing"}>
            {status === "subscribing" ? "Enabling…" : "Enable notifications"}
          </Button>
        )}
        {message && (
          <p className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Coming soon - reviewing individual reminders here once the agenda view exists.
        </p>
      </CardContent>
    </Card>
  );
}
