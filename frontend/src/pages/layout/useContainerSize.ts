import { useCallback, useEffect, useRef, useState } from "react";
import type { Size } from "./viewport";

/** Tracks a DOM element's actual rendered content size via `ResizeObserver`
 * - lets a canvas `Stage` size itself to whatever space its wrapping div
 * actually has, instead of a fixed pixel constant. A fixed-size Stage inside
 * an `overflow-auto` wrapper used to produce real page-level scroll bars
 * whenever the fixed size didn't match the available viewport (see the "No
 * scroll bars in Bed Layout screen" backlog item) - this replaces that with
 * "the canvas is always exactly as big as the space it's given."
 *
 * Returns a callback ref (not a plain `useRef`) so the same hook instance
 * can be reattached to whichever wrapper div is actually mounted right now
 * (Layout.tsx swaps between a "mine"-mode and an "example"-mode Stage, only
 * one of which renders at a time) without leaking a stale observer on the
 * unmounted one. `fallback` is what's returned before the first real
 * measurement lands (initial mount, before layout has settled). */
export function useContainerSize(fallback: Size): { ref: (node: HTMLDivElement | null) => void; size: Size } {
  const [size, setSize] = useState<Size>(fallback);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) });
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, size };
}
