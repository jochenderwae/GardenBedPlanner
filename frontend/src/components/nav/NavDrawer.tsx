import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Menu,
  Sprout,
  LayoutGrid,
  LayoutTemplate,
  CalendarDays,
  ChartGantt,
  ShoppingBasket,
  Wrench,
  ClipboardList,
  TrendingUp,
  Settings as SettingsIcon,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/layout", label: "Bed Planner", icon: LayoutTemplate },
  { to: "/plants", label: "Plants Database", icon: Sprout },
  { to: "/equipment", label: "Equipment", icon: Wrench },
  { to: "/garden-plan", label: "Garden Plan", icon: ClipboardList },
  { to: "/yield-history", label: "Yield History", icon: TrendingUp },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/timeline", label: "Timeline", icon: ChartGantt },
  { to: "/seed-guide", label: "Seed Guide", icon: ShoppingBasket },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function NavDrawer() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu />
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/20 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col gap-1 bg-background p-4 shadow-xl outline-none transition-transform data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full">
          <Dialog.Title className="mb-3 px-2 text-sm font-medium text-muted-foreground">
            GardenBedPlanner
          </Dialog.Title>
          {/* Plain <Link>s, not Dialog.Close - Dialog.Close forces
              role="button" onto whatever it renders (it's semantically a
              close action), which would make a screen reader announce a
              navigation link as a button. Closing on click is handled by
              the controlled `open` state instead. */}
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted",
                  location.pathname === to && "bg-muted",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
