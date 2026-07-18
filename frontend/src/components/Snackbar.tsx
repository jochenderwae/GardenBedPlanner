import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SnackbarState {
  id: number;
  message: string;
  onUndo?: () => void;
}

interface SnackbarContextValue {
  /** Shows a message for a few seconds. Pass onUndo to add an Undo action -
   * used after every autosaved change on the plant detail page so a bad
   * edit (or an accidental delete) is one click to reverse. */
  show: (message: string, onUndo?: () => void) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

const DISMISS_MS = 6000;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const show = useCallback((message: string, onUndo?: () => void) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const id = ++nextId.current;
    setSnackbar({ id, message, onUndo });
    timeoutRef.current = setTimeout(() => {
      setSnackbar((current) => (current?.id === id ? null : current));
    }, DISMISS_MS);
  }, []);

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}
      <div
        className={cn(
          "fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 transition-all",
          snackbar ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        {snackbar && (
          <div className="flex items-center gap-3 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-lg">
            <span>{snackbar.message}</span>
            {snackbar.onUndo && (
              <Button
                size="sm"
                variant="ghost"
                className="text-background hover:bg-background/20 hover:text-background"
                onClick={() => {
                  snackbar.onUndo?.();
                  setSnackbar(null);
                }}
              >
                Undo
              </Button>
            )}
          </div>
        )}
      </div>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error("useSnackbar must be used within a SnackbarProvider");
  return ctx;
}
