import { NavLink, Outlet } from "react-router-dom";
import { Bell, CalendarDays, Home as HomeIcon, NotebookPen, ShoppingBasket } from "lucide-react";
import { cn } from "@/lib/utils";
import { SnackbarProvider } from "@/components/Snackbar";

const MOBILE_NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/seed-guide", label: "Seeds", icon: ShoppingBasket },
  { to: "/logging", label: "Logging", icon: NotebookPen },
  { to: "/notifications", label: "Notifications", icon: Bell },
];

/** The mobile/PWA route set's own shell - a bottom tab bar, not the
 * desktop's hamburger `NavDrawer`, and no Konva/canvas editor anywhere in
 * this tree. Per root CLAUDE.md's convention: "Mobile PWA views are a
 * distinct, simplified route set (logging, agenda, notifications) - not a
 * cut-down version of the canvas editor." See `RootShell` for how a
 * viewport width switches between this and the desktop `AppShell`. */
export function MobileShell() {
  return (
    <SnackbarProvider>
      <div className="flex h-svh flex-col text-left">
        <header className="border-b px-4 py-3">
          <span className="text-sm font-medium">GardenBedPlanner</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
        <nav className="flex border-t">
          {MOBILE_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-muted-foreground",
                  isActive && "text-primary",
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </SnackbarProvider>
  );
}
