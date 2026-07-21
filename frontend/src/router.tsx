import { createBrowserRouter } from "react-router-dom";
import { RootShell } from "@/components/nav/RootShell";

// A single catch-all entry - RootShell itself decides (via
// useIsMobileViewport) which nested <Routes> tree (desktop vs. the
// mobile/PWA route set) actually handles the current path. See RootShell's
// own doc for why the branching lives there instead of two duplicate
// top-level trees here.
export const router = createBrowserRouter([{ path: "*", element: <RootShell /> }]);
