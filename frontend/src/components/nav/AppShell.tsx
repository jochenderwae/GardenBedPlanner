import { Outlet } from "react-router-dom";
import { NavDrawer } from "@/components/nav/NavDrawer";
import { SnackbarProvider } from "@/components/Snackbar";

export function AppShell() {
  return (
    <SnackbarProvider>
      <div className="flex min-h-svh flex-col text-left">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <NavDrawer />
          <span className="text-sm font-medium">GardenBedPlanner</span>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </SnackbarProvider>
  );
}
