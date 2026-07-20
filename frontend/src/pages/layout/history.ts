import { useCallback, useRef, useState } from "react";

/** One undoable step: applying `undo` restores the state from just before
 * the change, applying `redo` re-applies it. Callers build these as
 * inverse-PATCH pairs around an existing mutation call (see Layout.tsx's
 * geometry-change handlers) - `undo`/`redo` just call that same mutation
 * function with the "before" or "after" patch, they don't know anything
 * about geometry/PATCH themselves. */
export interface HistoryEntry {
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 50;

export interface HistoryStack {
  push: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

/** Plain, framework-free linear undo/redo stack - deliberately not a full
 * command-pattern engine (see the backlog item this was built for): callers
 * push one entry per geometry mutation, and pushing a new entry always
 * clears `future` (the standard "any new edit invalidates redo" rule).
 * Kept independent of React so it can be unit-tested directly, the same
 * pure-function style as geometry.ts/viewport.ts in this directory -
 * `useUndoHistory` below is just a thin React wrapper that re-renders on
 * every mutation. */
export function createHistoryStack(limit = HISTORY_LIMIT): HistoryStack {
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];

  return {
    push(entry) {
      past.push(entry);
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo() {
      const entry = past.pop();
      if (!entry) return;
      entry.undo();
      future.push(entry);
    },
    redo() {
      const entry = future.pop();
      if (!entry) return;
      entry.redo();
      past.push(entry);
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

/** React binding for `createHistoryStack` - the stack itself lives in a ref
 * so `push`/`undo`/`redo` don't need to be recreated each render; a small
 * render-counter state forces `canUndo`/`canRedo` to update for consumers
 * (e.g. toolbar button `disabled` state). */
export function useUndoHistory() {
  const stack = useRef<HistoryStack | null>(null);
  if (!stack.current) stack.current = createHistoryStack();
  const [, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  const push = useCallback(
    (entry: HistoryEntry) => {
      stack.current!.push(entry);
      rerender();
    },
    [rerender],
  );

  const undo = useCallback(() => {
    stack.current!.undo();
    rerender();
  }, [rerender]);

  const redo = useCallback(() => {
    stack.current!.redo();
    rerender();
  }, [rerender]);

  return {
    push,
    undo,
    redo,
    canUndo: stack.current.canUndo(),
    canRedo: stack.current.canRedo(),
  };
}
