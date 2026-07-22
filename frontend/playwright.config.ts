import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Owned by the `tester` agent (.claude/agents/tester.md) - it writes and
 * maintains the actual specs under `./e2e`. Chromium-only by default to keep
 * runs fast; add firefox/webkit projects back if cross-browser coverage is
 * ever actually needed for a specific bug.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Forced serial even locally (not left at the default of one worker per
  // core): canvas specs that dispatch precisely-timed real mouse gestures
  // (see bed-canvas-drag-pan.spec.ts) depend on exact mousemove-event
  // timing for Konva's own drag-start threshold to register - under
  // multi-way parallelism on this dev machine that timing got disturbed
  // enough by CPU contention between concurrent Chromium instances to be
  // genuinely nondeterministic in *both* directions: legitimate assertions
  // occasionally missed their PATCH window (false failure), and - more
  // concerning - a confirmed-real bug (a middle-mouse-drag starting on a
  // bed nudging it slightly, see that spec's own comment) was masked
  // (false pass) in one 2-worker run despite reproducing 8/8 times serially
  // right before and after. Serial removes that variable entirely; this
  // suite is small enough (~8s) that the speed cost doesn't matter yet - if
  // that changes, split slow specs into their own serial project instead of
  // relaxing this globally.
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
