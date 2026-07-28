import { Route, Routes } from "react-router-dom";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";
import { AppShell } from "@/components/nav/AppShell";
import { Home } from "@/pages/Home";
import { Layout } from "@/pages/Layout";
import { TechnicalDrawing } from "@/pages/TechnicalDrawing";
import { PlantsDatabase } from "@/pages/PlantsDatabase";
import { PlantDetail } from "@/pages/PlantDetail";
import { Agenda } from "@/pages/Agenda";
import { TaskDetail } from "@/pages/TaskDetail";
import { MobileShell } from "@/pages/mobile/MobileShell";
import { MobileHome } from "@/pages/mobile/MobileHome";
import { MobileAgenda } from "@/pages/mobile/MobileAgenda";
import { MobileLogging } from "@/pages/mobile/MobileLogging";
import { MobileNotifications } from "@/pages/mobile/MobileNotifications";
import { MobileSeedGuide } from "@/pages/mobile/MobileSeedGuide";
import { SeedGuide } from "@/pages/SeedGuide";

/** Root of the route tree - switches between the desktop canvas-editor app
 * and a genuinely separate, simplified mobile/PWA route set based on
 * viewport width (`useIsMobileViewport`), rather than trying to make the
 * Konva editor responsive down to phone width (see root CLAUDE.md's
 * "Conventions" section and the "Mobile/PWA simplified route set" backlog
 * item). `router.tsx` mounts this as a single catch-all entry; both
 * branches below declare their own nested `<Routes>` rather than two
 * duplicate top-level route trees living in router.tsx itself. */
export function RootShell() {
  const isMobile = useIsMobileViewport();

  if (isMobile) {
    return (
      <Routes>
        <Route element={<MobileShell />}>
          <Route path="/" element={<MobileHome />} />
          <Route path="/agenda" element={<MobileAgenda />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/seed-guide" element={<MobileSeedGuide />} />
          <Route path="/logging" element={<MobileLogging />} />
          <Route path="/notifications" element={<MobileNotifications />} />
          {/* A desktop-only deep link (e.g. a bookmark to /layout) opened at
              phone width lands on the mobile home instead of a 404 - there's
              no mobile equivalent of the canvas editor to route it to. */}
          <Route path="*" element={<MobileHome />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/layout" element={<Layout />} />
        <Route path="/layout/beds/:bedId/technical-drawing" element={<TechnicalDrawing />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/seed-guide" element={<SeedGuide />} />
        <Route path="/plants" element={<PlantsDatabase />} />
        <Route path="/plants/:slug" element={<PlantDetail />} />
      </Route>
    </Routes>
  );
}
