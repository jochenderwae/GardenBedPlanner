import { useCallback, useState } from "react";
import { getVapidPublicKey, registerPushSubscription } from "@/api/client";

export type PushSubscriptionStatus = "unsupported" | "idle" | "subscribing" | "subscribed" | "denied" | "error";

/** Standard Web Push base64url -> Uint8Array conversion (the VAPID public
 * key comes back from the backend as base64url, but PushManager.subscribe's
 * applicationServerKey wants raw bytes) - see
 * https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  // Explicit ArrayBuffer (not just a length) so this is a
  // Uint8Array<ArrayBuffer> - PushManager.subscribe's applicationServerKey
  // wants BufferSource, which newer TS DOM typings only accept an
  // ArrayBuffer-backed (not SharedArrayBuffer-backed) typed array for.
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

/** Registers this browser for Web Push - requests Notification permission,
 * subscribes via the installed service worker's PushManager (vite-plugin-pwa
 * registers that service worker automatically), and registers the resulting
 * subscription with the backend (see #46's send side). iOS Safari
 * specifically requires the PWA to already be installed via "Add to Home
 * Screen" before this permission request will succeed - see root
 * CLAUDE.md's Notifications section; this hook can't detect or work around
 * that, it just surfaces whatever the browser itself reports. */
export function useWebPushSubscription() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [status, setStatus] = useState<PushSubscriptionStatus>(supported ? "idle" : "unsupported");
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(async () => {
    if (!supported) return;
    setStatus("subscribing");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const { public_key } = await getVapidPublicKey();
      if (!public_key) {
        throw new Error("Push notifications aren't configured on the server yet.");
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(public_key),
        }));

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("The browser returned an incomplete push subscription.");
      }

      await registerPushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        user_agent: navigator.userAgent,
      });

      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications.");
      setStatus("error");
    }
  }, [supported]);

  return { status, error, subscribe };
}
