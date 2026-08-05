import { useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Autocomplete, AutocompleteInput, AutocompleteItem, AutocompleteList, AutocompletePopup } from "@/components/ui/autocomplete";
import { cn } from "@/lib/utils";
import type { FieldType, FieldValue, SelectOption } from "./fields";

/** `InlineEditableField`'s own type union - a superset of `fields.ts`'s
 * `FieldType` (every "simple" scalar type it now supports, per #237's
 * round-2 generalization) plus `"autocomplete"`, which isn't a
 * `FieldConfig.type` at all - it's identity-line-only wiring for family/
 * genus (their `FieldConfig` entries stay plain `"text"`, since they're
 * never rendered through the generic tiered loop). `"multiselect"` is
 * deliberately absent - out of scope per the design spec, `edible_parts`
 * keeps `FieldInput.tsx`'s existing popover-checkbox-group rendering. */
export type InlineEditType = Exclude<FieldType, "multiselect"> | "autocomplete";

interface InlineEditableFieldProps {
  value: FieldValue;
  /** @default "text" */
  type?: InlineEditType;
  /** For `type="select"`. */
  options?: SelectOption[];
  /** For `type="autocomplete"` - distinct existing values to suggest. */
  autocompleteItems?: string[];
  /** Accessible name for both the collapsed trigger button and whichever
   * control it swaps to - set directly via `aria-label` on the control
   * itself rather than an enclosing `<label htmlFor>`, so there's no
   * implicit/explicit label-association surface for `FieldHint`'s own
   * `<button>` (rendered by callers *outside* this component, e.g.
   * `FieldRow`) to steal from in the first place - see #213. */
  ariaLabel: string;
  /** Shown, muted, in place of a real value. */
  placeholder: string;
  onCommit: (newValue: FieldValue, previousValue: FieldValue) => void;
  /** Text-size/weight/width - varies by caller (identity-line name gets
   * page-heading scale, a compact `FieldRow` value gets body scale). */
  className?: string;
  /** True only for the plant name instance, which `PlantDetail.tsx` wraps
   * in a real `<h1>` - the collapsed trigger button's own visible text
   * *is* the page's title there, so it should be the h1's accessible name
   * too (plain content-based computation), not the usual "Edit <field>"
   * override (which, for a plant literally named e.g. "Growth Habit
   * Plant", would otherwise substring-collide with `getByLabel("Growth
   * habit")`-style queries against an unrelated field elsewhere on the
   * same page - a real regression this flag exists to avoid). Every other
   * caller keeps the "Edit <field>" override, which carries real context
   * their own bare value text doesn't. */
  skipEditAriaLabel?: boolean;
}

function hasRealValue(value: FieldValue, type: InlineEditType): boolean {
  if (value === null || value === undefined) return false;
  if (type === "tristate") return true; // false is a real value ("No")
  return value !== "";
}

function selectDisplayLabel(value: FieldValue, type: InlineEditType, options?: SelectOption[]): string {
  if (type === "tristate") return value === true ? "Yes" : "No";
  return options?.find((o) => o.value === value)?.label ?? String(value);
}

/** Click-to-edit field (#209's Option A layout, generalized by #237's round
 * 2 to every "simple" scalar type, not just text) - plain text/prose by
 * default (a real focusable/keyboard-activatable `<button>`, not a bare
 * `<span>`, so screen-reader/keyboard users can discover it's editable),
 * swapping to a type-appropriate control on click/Enter/Space. Reuses
 * whatever `onCommit` wiring the caller already has
 * (`PlantDetail.tsx`'s `usePlantAutosave().saveField`) - this is a new
 * *display* mode for an existing save mechanism, not a new one.
 *
 * Per-type editing-control behavior (see the design spec comment on #237
 * for the full rationale):
 * - `text`/`number`/`autocomplete`: `Escape` reverts without saving,
 *   `Enter`/blur commits.
 * - `select`/`tristate`: swaps to a native `<Select>`, autofocused but not
 *   programmatically opened (`.click()` on a `<select>` is browser-
 *   inconsistent - focus alone, standard keyboard/click behavior from
 *   there); `onChange` commits immediately and collapses back (a select's
 *   change *is* the commit, no separate confirm step), blur with no change
 *   just collapses.
 * - `textarea`: swaps to a `<Textarea>`. Real divergence from every other
 *   variant - `Enter` must *not* commit, it inserts a newline; only
 *   `Escape` cancels and blur commits. Collapsed display clamps to ~2
 *   lines rather than always rendering full text inline. */
export function InlineEditableField({
  value,
  type = "text",
  options,
  autocompleteItems,
  ariaLabel,
  placeholder,
  onCommit,
  className,
  skipEditAriaLabel = false,
}: InlineEditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldValue>(value);

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  function commit(nextValue: FieldValue) {
    setEditing(false);
    if (nextValue !== value) onCommit(nextValue, value);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  function normalizedDraft(): FieldValue {
    if (type === "number") return draft;
    if (typeof draft === "string") {
      const trimmed = draft.trim();
      return trimmed === "" ? null : trimmed;
    }
    return draft;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(normalizedDraft());
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
    if (type === "select" || type === "tristate") {
      const selectOptions: SelectOption[] =
        type === "tristate"
          ? [
              { value: "", label: "Unknown" },
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]
          : [{ value: "", label: "—" }, ...(options ?? [])];
      const selectValue = value === null || value === undefined ? "" : String(value);
      return (
        <Select
          aria-label={ariaLabel}
          autoFocus
          value={selectValue}
          onChange={(e) => {
            const raw = e.target.value;
            const next: FieldValue = type === "tristate" ? (raw === "" ? null : raw === "true") : raw === "" ? null : raw;
            commit(next);
          }}
          onBlur={() => setEditing(false)}
          className={cn("h-auto w-auto min-w-32 py-0.5", className)}
        >
          {selectOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      );
    }

    if (type === "textarea") {
      return (
        <Textarea
          aria-label={ariaLabel}
          autoFocus
          rows={3}
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(normalizedDraft())}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            // Deliberately no Enter handling - inserts a newline, doesn't
            // commit, matching FieldInput.tsx's own existing textarea
            // behavior.
          }}
          className={cn("w-full", className)}
        />
      );
    }

    if (type === "autocomplete") {
      return (
        <Autocomplete
          items={autocompleteItems ?? []}
          value={typeof draft === "string" ? draft : ""}
          onValueChange={(v) => setDraft(v)}
          openOnInputClick
        >
          <AutocompleteInput
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoFocus
            onBlur={() => commit(normalizedDraft())}
            onKeyDown={handleKeyDown}
            className={cn("h-auto w-auto min-w-32 py-0.5", className)}
          />
          <AutocompletePopup>
            <AutocompleteList>
              {(item: string) => (
                <AutocompleteItem key={item} value={item}>
                  {item}
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompletePopup>
        </Autocomplete>
      );
    }

    // text / number
    return (
      <Input
        aria-label={ariaLabel}
        type={type === "number" ? "number" : "text"}
        value={type === "number" ? (draft === null || draft === undefined ? "" : String(draft)) : typeof draft === "string" ? draft : ""}
        onChange={(e) => setDraft(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
        onBlur={() => commit(normalizedDraft())}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        autoFocus
        className={cn("h-auto w-auto min-w-32 py-0.5", className)}
      />
    );
  }

  const displayValue = hasRealValue(value, type)
    ? type === "select" || type === "tristate"
      ? selectDisplayLabel(value, type, options)
      : String(value)
    : placeholder;

  return (
    <button
      type="button"
      aria-label={skipEditAriaLabel ? undefined : `Edit ${ariaLabel}`}
      onClick={startEditing}
      onKeyDown={handleTriggerKeyDown}
      className={cn(
        "group -mx-1 inline-flex items-center gap-1 rounded px-1 text-left hover:bg-muted/50",
        !hasRealValue(value, type) && "text-muted-foreground italic",
        type === "textarea" && "line-clamp-2 w-full items-start whitespace-pre-wrap",
        className,
      )}
    >
      <span className={type === "textarea" ? "flex-1" : undefined}>{displayValue}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
