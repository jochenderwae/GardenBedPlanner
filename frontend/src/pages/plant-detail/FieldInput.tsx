import { ChevronDown } from "lucide-react";
import { inputVariants } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { FieldHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { InlineEditableField } from "./InlineEditableField";
import type { FieldConfig, FieldValue } from "./fields";

interface FieldInputProps {
  field: FieldConfig;
  value: FieldValue;
  onCommit: (newValue: FieldValue, previousValue: FieldValue) => void;
}

/** The label-row shared by every branch below - field name plus the
 * info-icon tooltip that replaced the old `title` attribute on the
 * enclosing `<label>` (see the "replace title= attribute tooltips"
 * backlog item). */
function FieldLabel({ field }: { field: FieldConfig }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      {field.label}
      <FieldHint description={field.description} />
    </span>
  );
}

/** #237 round 2's compact "Label: value" row - text/number/select/tristate
 * only (the "short" types, per the design spec's item 6 resolution).
 * `InlineEditableField`'s own collapsed `<button>`/type-appropriate editing
 * control carries its own `aria-label`, so this deliberately isn't a
 * `<label htmlFor>` wrapper (there's no single stable form-control id to
 * point at across the collapsed/editing swap) - see `InlineEditableField`'s
 * own `ariaLabel` doc for why that's not a #213 regression. */
function FieldRow({ field, value, onCommit }: FieldInputProps) {
  return (
    <div className="flex items-baseline gap-1.5 text-sm">
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-muted-foreground">
        {field.label}
        <FieldHint description={field.description} />:
      </span>
      <InlineEditableField
        type={field.type as "text" | "number" | "select" | "tristate"}
        options={field.options}
        value={value}
        ariaLabel={field.label}
        placeholder="—"
        onCommit={onCommit}
      />
    </div>
  );
}

/** Textarea fields keep today's label-above/block-below layout (per the
 * design spec's item 6 resolution - a multi-line value doesn't fit a
 * same-line "Label: value" row) but gain click-to-edit like every other
 * "simple" type (item 5) - collapsed display clamps to ~2 lines via
 * `InlineEditableField`'s own `type="textarea"` styling. */
function TextareaFieldRow({ field, value, onCommit }: FieldInputProps) {
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <FieldLabel field={field} />
      <InlineEditableField type="textarea" value={value} ariaLabel={field.label} placeholder="Add notes…" onCommit={onCommit} className="w-full" />
    </div>
  );
}

/** Out of #237's inline-edit generalization (design spec's own call) -
 * `edible_parts`, the one array-valued field, keeps this existing
 * popover-checkbox-group rendering unchanged. */
function MultiselectFieldRow({ field, value, onCommit }: FieldInputProps) {
  const selected = Array.isArray(value) ? value : [];
  const options = field.options ?? [];
  // Comma-joined summary of the current selection, in the options' own
  // declared order (not raw value/insertion order) - "None selected"
  // when empty, matching a typical closed multi-select combobox rather
  // than an always-expanded checkbox group.
  const summary = options
    .filter((opt) => selected.includes(opt.value))
    .map((opt) => opt.label)
    .join(", ");

  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <FieldLabel field={field} />
      <Popover>
        <PopoverTrigger aria-label={field.label} className={cn(inputVariants({ className: "flex items-center justify-between gap-2 text-left" }))}>
          <span className={cn("truncate", !summary && "text-muted-foreground")}>{summary || "None selected"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverPopup>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">{field.label}</legend>
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked ? [...selected, opt.value] : selected.filter((v) => v !== opt.value);
                      onCommit(next, value);
                    }}
                  />
                  {opt.label}
                </label>
              );
            })}
          </fieldset>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

/** #237 round 2: generic per-`FieldConfig.type` renderer, now branching into
 * a compact click-to-edit `FieldRow` for the four "short" scalar types
 * (text/number/select/tristate), a block-layout click-to-edit `Textarea`
 * for the one multi-line type, and the unchanged popover-checkbox-group for
 * the one array-valued type (`multiselect`) - see each sub-component's own
 * doc for why. Keeps `FieldInput`'s own name/signature so call sites
 * (`PlantDetail.tsx`) don't need to change. */
export function FieldInput(props: FieldInputProps) {
  if (props.field.type === "multiselect") return <MultiselectFieldRow {...props} />;
  if (props.field.type === "textarea") return <TextareaFieldRow {...props} />;
  return <FieldRow {...props} />;
}
