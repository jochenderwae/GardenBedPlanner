import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input, inputVariants, Select, Textarea } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { FieldHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

export function FieldInput({ field, value, onCommit }: FieldInputProps) {
  const [draft, setDraft] = useState(value);

  // Reflect external changes (initial load, or an Undo reverting this same
  // field) without clobbering what the user is actively typing otherwise.
  useEffect(() => setDraft(value), [value]);

  function commitText() {
    const normalized = typeof draft === "string" && draft.trim() === "" ? null : draft;
    if (normalized !== value) onCommit(normalized, value);
  }

  if (field.type === "select" || field.type === "tristate") {
    const options =
      field.type === "tristate"
        ? [
            { value: "", label: "Unknown" },
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]
        : [{ value: "", label: "—" }, ...(field.options ?? [])];
    const selectValue = value === null || value === undefined ? "" : String(value);

    return (
      <label className="flex flex-col gap-1">
        <FieldLabel field={field} />
        <Select
          value={selectValue}
          onChange={(e) => {
            const raw = e.target.value;
            const newValue: FieldValue =
              field.type === "tristate" ? (raw === "" ? null : raw === "true") : raw === "" ? null : raw;
            onCommit(newValue, value);
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="flex flex-col gap-1">
        <FieldLabel field={field} />
        <Input
          type="number"
          value={draft === null || draft === undefined ? "" : String(draft)}
          onChange={(e) => setDraft(e.target.value === "" ? null : Number(e.target.value))}
          onBlur={() => {
            if (draft !== value) onCommit(draft, value);
          }}
        />
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    const options = field.options ?? [];
    // Comma-joined summary of the current selection, in the options' own
    // declared order (not raw value/insertion order) - "None selected"
    // when empty, matching a typical closed multi-select combobox rather
    // than the previous always-expanded checkbox group.
    const summary = options
      .filter((opt) => selected.includes(opt.value))
      .map((opt) => opt.label)
      .join(", ");

    return (
      <div className="flex flex-col gap-1">
        <FieldLabel field={field} />
        <Popover>
          <PopoverTrigger
            aria-label={field.label}
            className={cn(inputVariants({ className: "flex items-center justify-between gap-2 text-left" }))}
          >
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
                        const next = e.target.checked
                          ? [...selected, opt.value]
                          : selected.filter((v) => v !== opt.value);
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

  if (field.type === "textarea") {
    return (
      <label className="flex flex-col gap-1 sm:col-span-2">
        <FieldLabel field={field} />
        <Textarea
          rows={3}
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <FieldLabel field={field} />
      <Input
        type="text"
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
      />
    </label>
  );
}
