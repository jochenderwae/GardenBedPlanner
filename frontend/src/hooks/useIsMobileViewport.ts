import { useEffect, useState } from "react";

/** Tailwind's own `md` breakpoint (768px) - below this, the app renders the
 * distinct, simplified mobile/PWA route set (see `RootShell`) instead of
 * the desktop canvas-editor app, matching this project's other Tailwind
 * breakpoint usage (e.g. `FieldInput`'s `sm:col-span-2`) rather than
 * introducing a separate, arbitrary cutoff. */
const MOBILE_BREAKPOINT_PX = 768;

/** True when the viewport is narrower than the mobile breakpoint - tracks
 * live `matchMedia` changes (window resize, device rotation) rather than
 * only checking once on mount, so e.g. rotating a tablet or resizing a
 * desktop browser window crosses the breakpoint without a reload. */
export function useIsMobileViewport(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [query]);

  return isMobile;
}
