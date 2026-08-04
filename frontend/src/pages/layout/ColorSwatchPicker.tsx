import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** A garden-appropriate preset palette (#242's own design spec) - name each
 * swatch carries into its `aria-label` since a colored circle alone isn't
 * announced meaningfully by a screen reader. */
const PRESET_SWATCHES: { color: string; name: string }[] = [
  { color: "#b45309", name: "Terracotta" },
  { color: "#78350f", name: "Wood brown" },
  { color: "#78716c", name: "Stone gray" },
  { color: "#4d7c0f", name: "Moss green" },
  { color: "#475569", name: "Slate blue" },
  { color: "#fafaf9", name: "Warm white" },
  { color: "#292524", name: "Charcoal" },
  { color: "#c2410c", name: "Mulch orange" },
];

interface ColorSwatchPickerProps {
  value: string;
  onChange: (color: string) => void;
}

/** Color picker for a `Decoration`'s own render color (#242) - 8 preset
 * swatches plus a native `<input type="color">` for anything else. Reuses
 * the exact WAI-ARIA radiogroup keyboard pattern `RadioToggleGroup`
 * (`components/ui/toggle-group.tsx`) already implements (roving `tabIndex`,
 * Left/Right arrow keys both move focus *and* select) rather than a second
 * hand-rolled version - not built directly on top of that component since
 * its `options` are rendered as text labels, not colored swatches, and this
 * needs one extra always-focusable, never-arrow-navigated custom-color
 * input past the end of the roving group. */
export function ColorSwatchPicker({ value, onChange }: ColorSwatchPickerProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const isPreset = PRESET_SWATCHES.some((s) => s.color === value);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = PRESET_SWATCHES[(index + delta + PRESET_SWATCHES.length) % PRESET_SWATCHES.length];
    buttonRefs.current.get(next.color)?.focus();
    onChange(next.color);
  }

  return (
    <div className="flex items-center gap-1.5">
      <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
        {PRESET_SWATCHES.map((swatch, index) => (
          <button
            key={swatch.color}
            ref={(el) => {
              if (el) buttonRefs.current.set(swatch.color, el);
              else buttonRefs.current.delete(swatch.color);
            }}
            type="button"
            role="radio"
            aria-checked={value === swatch.color}
            aria-label={swatch.name}
            tabIndex={isPreset ? (value === swatch.color ? 0 : -1) : index === 0 ? 0 : -1}
            className={cn(
              "size-6 rounded-full border-2",
              value === swatch.color ? "border-ring ring-2 ring-ring/50" : "border-border",
            )}
            style={{ backgroundColor: swatch.color }}
            onClick={() => onChange(swatch.color)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          />
        ))}
      </div>
      <label className="inline-flex items-center gap-1">
        <input
          type="color"
          aria-label="Custom color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-6 cursor-pointer rounded border border-border p-0"
        />
        <span className="text-xs text-muted-foreground">Custom</span>
      </label>
    </div>
  );
}
