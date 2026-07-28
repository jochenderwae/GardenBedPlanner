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
      <div className="flex h-svh flex-col">
        <header className="border-b px-4 py-3">
          <span className="text-sm font-medium">GardenBedPlanner</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
        {/* pl-/pr- keep every label clear of the physical screen edge (worse
            under a notch/rounded-corner safe-area inset) - a flat 0.5rem
            floor, growing further via env(safe-area-inset-*) on a device
            that reports a bigger inset than that. See #168: at 390px CSS
            width the five flex-1 columns are ~78px each, and "Notifications"
            (the longest label, one unbreakable word) doesn't fit - without
            `min-w-0` on each NavLink below, a flex item never shrinks below
            its own content's min-content width, so the column itself grows
            past its share and the overflow runs straight to this nav's own
            edge with zero margin. */}
        <nav className="flex border-t pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          {MOBILE_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-center text-xs leading-tight font-medium text-wrap break-words text-muted-foreground",
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
