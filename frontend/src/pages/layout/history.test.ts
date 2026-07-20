import { describe, expect, it, vi } from "vitest";
import { createHistoryStack } from "./history";

function makeEntry() {
  const undo = vi.fn();
  const redo = vi.fn();
  return { undo, redo };
}

describe("createHistoryStack", () => {
  it("starts with nothing to undo or redo", () => {
    const stack = createHistoryStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo calls the entry's undo and moves it to the redo side", () => {
    const stack = createHistoryStack();
    const entry = makeEntry();
    stack.push(entry);
    expect(stack.canUndo()).toBe(true);

    stack.undo();
    expect(entry.undo).toHaveBeenCalledTimes(1);
    expect(entry.redo).not.toHaveBeenCalled();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
  });

  it("redo calls the entry's redo and moves it back to the undo side", () => {
    const stack = createHistoryStack();
    const entry = makeEntry();
    stack.push(entry);
    stack.undo();

    stack.redo();
    expect(entry.redo).toHaveBeenCalledTimes(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo/redo on an empty stack is a no-op", () => {
    const stack = createHistoryStack();
    expect(() => stack.undo()).not.toThrow();
    expect(() => stack.redo()).not.toThrow();
  });

  it("pushing a new entry clears the redo stack", () => {
    const stack = createHistoryStack();
    const first = makeEntry();
    const second = makeEntry();
    stack.push(first);
    stack.undo();
    expect(stack.canRedo()).toBe(true);

    stack.push(second);
    expect(stack.canRedo()).toBe(false);
    stack.redo();
    expect(second.redo).not.toHaveBeenCalled();
  });

  it("undoes and redoes multiple entries in the correct order", () => {
    const stack = createHistoryStack();
    const calls: string[] = [];
    const first = { undo: () => calls.push("undo-1"), redo: () => calls.push("redo-1") };
    const second = { undo: () => calls.push("undo-2"), redo: () => calls.push("redo-2") };
    stack.push(first);
    stack.push(second);

    stack.undo();
    stack.undo();
    expect(calls).toEqual(["undo-2", "undo-1"]);

    stack.redo();
    stack.redo();
    expect(calls).toEqual(["undo-2", "undo-1", "redo-1", "redo-2"]);
  });

  it("caps history length at the given limit, dropping the oldest entry", () => {
    const stack = createHistoryStack(2);
    const first = makeEntry();
    const second = makeEntry();
    const third = makeEntry();
    stack.push(first);
    stack.push(second);
    stack.push(third);

    // Only the two most recent entries survive - undoing three times only
    // invokes second and third's undo, not first's (it was evicted).
    stack.undo();
    stack.undo();
    expect(third.undo).toHaveBeenCalledTimes(1);
    expect(second.undo).toHaveBeenCalledTimes(1);
    expect(first.undo).not.toHaveBeenCalled();
    expect(stack.canUndo()).toBe(false);
  });
});
