import { useRef, type KeyboardEvent } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export interface ToggleGroupOption<T extends string> {
  value: T;
  label: string;
}

/** Shared visual language for every segmented-pill control in the canvas
 * editor (`flex rounded-md border p-0.5` container, `rounded px-2.5 py-1
 * text-xs font-medium` per option, `bg-primary text-primary-foreground`
 * when selected) - kept as one constant so `TabToggleGroup` and
 * `RadioToggleGroup` below render pixel-identically despite having
 * different ARIA semantics underneath. */
const GROUP_CLASS = "flex rounded-md border p-0.5";
const OPTION_CLASS = "rounded px-2.5 py-1 text-xs font-medium";

interface TabToggleGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ToggleGroupOption<T>[];
  className?: string;
}

/** For controls that are genuinely tabs - they switch which content/tool
 * panel is interactive, not just an option among equals (the
 * Garden/Beds/Plants/Equipment switcher in `Toolbar.tsx`, which drives
 * `PlacementTab` state that gates which canvas layer is interactive and
 * which side panel renders, per `Layout.tsx`). Built on base-ui's `Tabs`
 * primitive (`@base-ui/react/tabs`, same library `Dialog`/`AlertDialog`
 * already come from in this codebase) for `role="tablist"`/`"tab"`,
 * `aria-selected`, and roving-tabindex/arrow-key navigation for free,
 * instead of a hand-rolled ARIA pattern. Only renders `Tabs.Root`/`List`/
 * `Tab` - no `Tabs.Panel` - since the actual panel content lives elsewhere
 * in the tree, driven by the same `value` this reports out via `onChange`. */
export function TabToggleGroup<T extends string>({ value, onChange, options, className }: TabToggleGroupProps<T>) {
  return (
    <Tabs.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <Tabs.List className={cn(GROUP_CLASS, className)}>
        {options.map((option) => (
          <Tabs.Tab
            key={option.value}
            value={option.value}
            className={cn(OPTION_CLASS, value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {option.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

interface RadioToggleGroupProps<T extends string> {
  /** Announced as the group's accessible name (e.g. "View mode",
   * "Placement mode", "Shape type") - a radiogroup has no visible label of
   * its own the way a tablist's surrounding page context usually implies
   * one, so this is required rather than optional. */
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: ToggleGroupOption<T>[];
  className?: string;
  /** Stretches every option to share the container's width equally
   * (`flex-1`) instead of sizing to its own label - `ShapeTypeToggle`'s
   * narrow-sidebar usage wants this so its two-option toggle fills the
   * panel width the way it always has; the toolbar's own multi-option
   * groups don't. */
  fill?: boolean;
}

/** For controls that are a mutually-exclusive *option pick*, not navigation
 * between content panes (Edit/View mode, Point/Row/Area placement mode,
 * Rectangle/Polygon shape type) - closer to a radio group semantically even
 * though they share the same segmented-pill visual style as
 * `TabToggleGroup` above. base-ui doesn't ship a dedicated
 * radio-group-as-buttons primitive as of this repo's dependency set, so
 * this implements the standard WAI-ARIA radiogroup keyboard pattern
 * directly: `role="radiogroup"` + `aria-label`, each option
 * `role="radio"`/`aria-checked`, roving `tabIndex` (only the checked option
 * is in the tab order), and Left/Right arrow keys both move focus *and*
 * select the newly-focused option (unlike a tablist, a radiogroup has no
 * separate "focus without activating" state).
 *
 * `onChange` fires for every selection attempt, click or keyboard alike -
 * callers that need to intercept a selection (e.g. `ShapeTypeToggle`
 * confirming before a lossy Polygon->Rectangle conversion) just don't
 * commit the value change synchronously; the group doesn't assume
 * selecting an option always takes effect immediately. */
export function RadioToggleGroup<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
  className,
  fill = false,
}: RadioToggleGroupProps<T>) {
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    buttonRefs.current.get(next.value)?.focus();
    onChange(next.value);
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn(GROUP_CLASS, className)}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            if (el) buttonRefs.current.set(option.value, el);
            else buttonRefs.current.delete(option.value);
          }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className={cn(
            OPTION_CLASS,
            fill && "flex-1",
            value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => handleKeyDown(e, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
