import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/** Returns a click handler for a page's "Back" button that returns to
 * wherever the user actually came from (real browser/router history),
 * instead of a fixed hardcoded destination - see the "Fix back buttons"
 * backlog item. Every internal `<Link>` navigation in this app already
 * pushes a real history entry via react-router's data router
 * (`createBrowserRouter` in `router.tsx`), so `navigate(-1)` is enough; no
 * need to thread a `from` param through every entry point into these pages.
 *
 * Falls back to `fallbackPath` when there's no real in-app history entry to
 * go back to - e.g. the page was opened directly via a bookmark, a fresh
 * tab, or a hard refresh. `window.history.state?.idx` is the browser
 * data router's own signal for "how many entries has *this router* pushed
 * so far" (`chunk-SA4DP3SF.js`'s `createBrowserHistory` stamps every entry
 * with an incrementing `idx`, starting at 0 for the first one it creates) -
 * `idx === 0` means we're still on that very first entry, so `navigate(-1)`
 * would either do nothing (fall off the router's own history) or leave the
 * app entirely (into whatever page, if any, was open before this tab
 * navigated here), neither of which is "go back to where this page's own
 * in-app link came from." */
export function useNavigateBack(fallbackPath: string): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  }, [navigate, fallbackPath]);
}
