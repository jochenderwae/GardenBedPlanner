import { useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface InlineEditableFieldProps {
  value: string | null;
  /** Accessible name for both the collapsed trigger button and the input
   * it swaps to, e.g. "Family" - the field has no separate visible label
   * the way a `FieldInput` row does (the identity line reads as prose, not
   * a form), so this is the only place that name lives. */
  ariaLabel: string;
  /** Shown, muted, in place of a real value - "Add family…" rather than
   * blank space so an empty identity-line field is still discoverable as
   * editable. */
  placeholder: string;
  onCommit: (newValue: string, previousValue: string) => void;
  /** Text-size/weight - the name gets page-heading scale, family/genus get
   * something smaller/muted, same identity-line visual hierarchy the old
   * plain `<h1>`/`<p>` header already established. */
  className?: string;
}

/** Click-to-edit text (#237's Option A layout spec) - plain text by
 * default (a real focusable/keyboard-activatable `<button>`, not a bare
 * `<span>`, so screen-reader/keyboard users can discover it's editable),
 * swapping to a real `Input` on click/Enter/Space. Reuses whatever
 * `onCommit` wiring the caller already has (`PlantDetail.tsx`'s
 * `usePlantAutosave().saveField`) - this is a new *display* mode for an
 * existing save mechanism, not a new one. `Escape` reverts without saving;
 * `Enter`/blur commits. Deliberately name-only (no separate label text) -
 * see `ariaLabel`'s own doc. */
export function InlineEditableField({ value, ariaLabel, placeholder, onCommit, className }: InlineEditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function startEditing() {
    setDraft(value ?? "");
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "")) onCommit(trimmed, value ?? "");
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startEditing();
    }
  }

  if (editing) {
    return (
      <Input
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        autoFocus
        className={cn("h-auto w-auto min-w-32 py-0.5", className)}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Edit ${ariaLabel}`}
      onClick={startEditing}
      onKeyDown={handleTriggerKeyDown}
      className={cn(
        "group -mx-1 inline-flex items-center gap-1 rounded px-1 text-left hover:bg-muted/50",
        !value && "text-muted-foreground italic",
        className,
      )}
    >
      <span>{value || placeholder}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
