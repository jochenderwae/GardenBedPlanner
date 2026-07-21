import { Outlet } from "react-router-dom";
import { NavDrawer } from "@/components/nav/NavDrawer";
import { SnackbarProvider } from "@/components/Snackbar";

export function AppShell() {
  return (
    <SnackbarProvider>
      <div className="flex h-svh flex-col text-left">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <NavDrawer />
          <span className="text-sm font-medium">GardenBedPlanner</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </SnackbarProvider>
  );
}
