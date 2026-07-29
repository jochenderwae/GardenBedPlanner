import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "GardenBedPlanner",
        short_name: "GardenBed",
        description: "Plan and manage home garden beds and crops",
        // Matches src/index.css's light-mode --primary/--background OKLCH
        // tokens (#188's Terracotta & Clay scheme) - both hex values here
        // are exact OKLCH->sRGB conversions (Björn Ottosson's standard
        // OKLab formulas, the same ones browsers use for CSS oklch()), not
        // eyeballed: oklch(0.52 0.16 45) -> #af4000, oklch(0.98 0.008 70)
        // -> #fcf8f3. There's no build-time link between this manifest and
        // index.css's tokens - if the palette changes again, this needs a
        // manual update too (#202).
        theme_color: "#af4000",
        background_color: "#fcf8f3",
        display: "standalone",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-512x512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
