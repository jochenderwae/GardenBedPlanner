import { useEffect, useState } from "react";
import type { FieldConfig, FieldValue } from "./fields";

interface FieldInputProps {
  field: FieldConfig;
  value: FieldValue;
  onCommit: (newValue: FieldValue, previousValue: FieldValue) => void;
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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
      <label className="flex flex-col gap-1" title={field.description}>
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <select
          className={inputClass}
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
        </select>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="flex flex-col gap-1" title={field.description}>
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <input
          type="number"
          className={inputClass}
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
      <label className="flex flex-col gap-1" title={field.description}>
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <input
          type="text"
          className={inputClass}
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
      <label className="flex flex-col gap-1 sm:col-span-2" title={field.description}>
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <textarea
          className={inputClass}
          rows={3}
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1" title={field.description}>
      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
      <input
        type="text"
        className={inputClass}
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
      />
    </label>
  );
}
