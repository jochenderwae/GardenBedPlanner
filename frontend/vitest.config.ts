import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (not merged via `mergeConfig`) so the test
// pipeline doesn't need to load the PWA/Tailwind plugins, which have no
// bearing on unit tests and only slow down `vitest run` startup. Keeps the
// same `@` alias as the app config so tests import source the same way
// components do.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Pure-function tests only for now (geometry.ts/viewport.ts) - no DOM
    // needed. Switch to "jsdom" (and add the RTL/MSW setup from
    // docs/testing-plan.md) once component-level tests land.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
