import { useEffect, useState } from "react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
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

  if (field.type === "tags") {
    const textValue = Array.isArray(draft) ? draft.join(", ") : "";
    return (
      <label className="flex flex-col gap-1">
        <FieldLabel field={field} />
        <Input
          type="text"
          placeholder="fruit, leaves, ..."
          value={textValue}
          onChange={(e) =>
            setDraft(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          onBlur={() => {
            const normalized = Array.isArray(draft) ? draft : [];
            if (JSON.stringify(normalized) !== JSON.stringify(value ?? [])) {
              onCommit(normalized, value);
            }
          }}
        />
      </label>
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
