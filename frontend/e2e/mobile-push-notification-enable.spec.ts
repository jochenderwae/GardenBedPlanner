import { test, expect } from "@playwright/test";

/**
 * Real-browser coverage for #47's push-subscription UI wiring
 * (`useWebPushSubscription.ts`/`MobileNotifications.tsx`) - runs against
 * the normal dev server (unlike `pwa-manifest-service-worker.spec.ts`'s
 * manifest/service-worker checks, which need a real production build).
 * A fresh Playwright browser context never grants the Notification
 * permission automatically, so `Notification.requestPermission()`
 * resolves to something other than "granted" here - this deliberately
 * exercises that "permission not granted" path, which the code itself
 * short-circuits *before* it would ever touch `navigator.serviceWorker`,
 * so it doesn't actually need a real registered service worker (which the
 * dev server doesn't provide) to be a meaningful test of this component's
 * own state-machine wiring. The full "subscribed" success path (which
 * does need a real service worker) is covered separately in
 * `pwa-manifest-service-worker.spec.ts`, gated on `PWA_PREVIEW_URL`.
 */

test.describe("MobileNotifications 'Enable notifications' flow (#47)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("initial state shows the Enable button and description, no error yet", async ({ page }) => {
    await page.goto("/notifications");
    // CardTitle renders a plain data-slot="card-title" div, not a real
    // heading role.
    await expect(page.locator('[data-slot="card-title"]', { hasText: "Notifications" })).toBeVisible();
    await expect(page.getByText(/get reminders for due actions/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable notifications" })).toBeVisible();
  });

  test("clicking 'Enable notifications' without a granted permission surfaces the denied message, not a crash", async ({
    page,
    context,
  }) => {
    // Explicitly clear/deny rather than relying on the default (a fresh
    // context has no permission grant either way, but this makes the
    // scenario unambiguous rather than depending on Playwright's default
    // Notification.requestPermission() behavior staying whatever it is
    // today).
    await context.clearPermissions();

    await page.goto("/notifications");
    const enableButton = page.getByRole("button", { name: "Enable notifications" });
    await expect(enableButton).toBeVisible();
    await enableButton.click();

    // Whatever the browser's un-granted permission state resolves to
    // (Chromium under Playwright automation without an explicit grant
    // reports "denied", not the ambiguous "default" a real user's first
    // prompt would show), the component must land on a real status
    // message - not stay stuck on "Enabling…" forever, and not throw.
    await expect(
      page.getByText(/Notification permission was denied|doesn't support push notifications/),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Enabling…")).toHaveCount(0);
  });
});
