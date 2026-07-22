import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Real coverage for #149 ("PWA manifest ships with icons: [] - no
 * home-screen icon configured") - the implementer's own verification was
 * manual (pixel-read the alpha channel, `npm run build` + inspect
 * `dist/manifest.webmanifest`/`dist/index.html` by hand, curl the deployed
 * instance). None of that is repeatable automated coverage, and Playwright
 * against the local dev server can't exercise it either - `vite.config.ts`
 * doesn't set `VitePWA({ devOptions: { enabled: true } })`, so the manifest/
 * icons are only generated at build time, not served by `npm run dev`.
 *
 * Rather than requiring a `npm run build` (slow, and `dist/` may not exist
 * in a fresh checkout) as a test dependency, this verifies the actual
 * *source* artifacts a build would use: the 4 committed PNGs under
 * `public/` decode to the dimensions their filenames/manifest entries
 * claim (a real regression guard - a wrong-sized file silently swapped in
 * would otherwise only be caught by a human eyeballing a screenshot), and
 * `vite.config.ts`'s `manifest.icons` array + `index.html`'s
 * apple-touch-icon `<link>` both reference filenames that actually exist,
 * with the sizes/purposes they claim - catching a rename/regenerate that
 * forgot to update the other side, in either direction.
 *
 * Lives in `frontend/tests/`, not `frontend/src/`, deliberately: it needs
 * real Node globals (`fs`/`path`/`Buffer`/`__dirname`), which
 * `tsconfig.app.json` (the config `tsc -b`/`npm run build` typechecks
 * `src/` against) doesn't provide `@types/node` for - putting a
 * Node-context test file under `src/` would fail the production
 * typecheck. `tsconfig.node.json` already has `types: ["node"]` (it's
 * what typechecks `vite.config.ts` itself) and now also covers this
 * directory - see its own `include` array. `vitest.config.ts`'s `include`
 * glob picks this directory up too, alongside `src/**\/*.test.ts`.
 */

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(FRONTEND_ROOT, "public");

/** PNG width/height live in the IHDR chunk, always the first chunk right
 * after the 8-byte signature: 4-byte length, 4-byte type ("IHDR"), then
 * 4-byte width + 4-byte height (both big-endian uint32) - no PNG-decoding
 * library needed for just the dimensions. */
function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8);
  const expectedSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expectedSignature)) {
    throw new Error(`${filePath} does not have a valid PNG signature`);
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error(`${filePath}'s first chunk is "${chunkType}", expected IHDR`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("PWA manifest icons (#149)", () => {
  it.each([
    ["pwa-192x192.png", 192, 192],
    ["pwa-512x512.png", 512, 512],
    ["pwa-512x512-maskable.png", 512, 512],
    ["apple-touch-icon.png", 180, 180],
  ])("%s decodes to its claimed %dx%d dimensions", (filename, expectedWidth, expectedHeight) => {
    const { width, height } = readPngDimensions(path.join(PUBLIC_DIR, filename));
    expect(width).toBe(expectedWidth);
    expect(height).toBe(expectedHeight);
  });

  it("every icon file is non-trivially sized (not an empty/corrupt placeholder)", () => {
    for (const filename of ["pwa-192x192.png", "pwa-512x512.png", "pwa-512x512-maskable.png", "apple-touch-icon.png"]) {
      const size = readFileSync(path.join(PUBLIC_DIR, filename)).length;
      expect(size, `${filename} is suspiciously small/empty`).toBeGreaterThan(100);
    }
  });

  it("vite.config.ts's manifest.icons entries reference files that actually exist in public/", () => {
    const viteConfigSource = readFileSync(path.join(FRONTEND_ROOT, "vite.config.ts"), "utf-8");
    const iconEntries = [
      { src: "pwa-192x192.png", sizes: "192x192", purpose: "any" },
      { src: "pwa-512x512.png", sizes: "512x512", purpose: "any" },
      { src: "pwa-512x512-maskable.png", sizes: "512x512", purpose: "maskable" },
    ];
    for (const entry of iconEntries) {
      // Regex, not a full TS parse - matches this file's own object-literal
      // shape (`{ src: "...", sizes: "...", ..., purpose: "..." }`) closely
      // enough to catch a real drift without needing a TS AST parser here.
      const pattern = new RegExp(
        `src:\\s*["']${entry.src}["'][^}]*sizes:\\s*["']${entry.sizes}["'][^}]*purpose:\\s*["']${entry.purpose}["']`,
      );
      expect(
        pattern.test(viteConfigSource),
        `vite.config.ts's manifest.icons doesn't declare ${entry.src} with sizes=${entry.sizes} purpose=${entry.purpose}`,
      ).toBe(true);
      // The referenced file must actually exist - catches a rename on one
      // side that forgot to update the other.
      expect(() => readPngDimensions(path.join(PUBLIC_DIR, entry.src))).not.toThrow();
    }
  });

  it("index.html links the apple-touch-icon to a file that actually exists", () => {
    const indexHtml = readFileSync(path.join(FRONTEND_ROOT, "index.html"), "utf-8");
    expect(indexHtml).toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('href="/apple-touch-icon.png"');
    expect(() => readPngDimensions(path.join(PUBLIC_DIR, "apple-touch-icon.png"))).not.toThrow();
  });
});
