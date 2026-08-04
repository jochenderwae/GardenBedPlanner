import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import type { PlantUpdate } from "@/api/client";
import { LIFE_CYCLE_OPTIONS, type FieldValue } from "./fields";

type LifeCycle = "annual" | "biennial" | "perennial" | null;

/** annual/biennial have one correct year count each; perennial (or unset)
 * has no fixed count - years there is free-form (empty, or however many
 * years the plant actually stays productive). */
function yearsForLifeCycle(cycle: LifeCycle): number | null {
  if (cycle === "annual") return 1;
  if (cycle === "biennial") return 2;
  return null;
}

/** Inverse: infer the life cycle term implied by a specific year count.
 * `null` means "no inference" (an empty/invalid count doesn't imply
 * anything, so the caller should leave the existing life_cycle alone). */
function lifeCycleForYears(years: number | null): LifeCycle {
  if (years === 1) return "annual";
  if (years === 2) return "biennial";
  if (years != null && years >= 3) return "perennial";
  return null;
}

interface LifeCycleFieldsProps {
  lifeCycle: LifeCycle;
  lifeCycleYears: number | null;
  onSave: (
    patch: Partial<Record<keyof PlantUpdate, FieldValue>>,
    previous: Partial<Record<keyof PlantUpdate, FieldValue>>,
    label: string,
  ) => void;
}

/** `life_cycle` and `life_cycle_years` are correlated (annual = 1 year,
 * biennial = 2 years, perennial = empty/unknown or 3+ years) - unlike every
 * other Plant field, which the generic SCALAR_FIELDS/FieldInput loop in
 * PlantDetail.tsx renders and commits fully independently, these two are
 * rendered together here and kept in sync in both directions: picking
 * annual/biennial auto-fills years; typing a specific year count infers
 * the matching life cycle term. See the "Life cycle years should not be
 * independent of Life Cycle" backlog item. Both fields commit together as
 * a single patch (via `onSave`, PlantDetail's `usePlantAutosave().savePatch`)
 * so a later Undo reverts both consistently rather than leaving them out of
 * sync. */
export function LifeCycleFields({ lifeCycle, lifeCycleYears, onSave }: LifeCycleFieldsProps) {
  const [yearsDraft, setYearsDraft] = useState(lifeCycleYears);

  // Reflect external changes (initial load, an Undo, or the life_cycle
  // select's own commit below setting years) without clobbering what the
  // user is actively typing otherwise - same pattern as FieldInput.
  useEffect(() => setYearsDraft(lifeCycleYears), [lifeCycleYears]);

  // Self-heals a *loaded* plant whose stored life_cycle/life_cycle_years
  // pair is already inconsistent - commitLifeCycle/commitYears above only
  // ever fire on an interactive onChange, so a record that arrived
  // inconsistent (imported before this correlation existed, or edited
  // outside this UI - ~215/359 real plants on record, all annual/biennial
  // with a null years) just displayed the mismatch forever, until someone
  // happened to re-pick the same life_cycle value. Runs whenever these
  // props actually change (mount, plant navigation, Undo unwinding to an
  // older snapshot) rather than every render, and commits through the same
  // `onSave` path `commitLifeCycle` uses so the correction is a normal
  // undoable autosave, not a silent bypass. Deliberately one-directional
  // (life_cycle -> years only, never inferring life_cycle from years on
  // load) - the real inconsistent data is exclusively "cycle set, years
  // missing/wrong", and a perennial's free-form years (however many, or
  // none) is valid as-is and must be left alone (see "How to test" #5).
  useEffect(() => {
    if (lifeCycle !== "annual" && lifeCycle !== "biennial") return;
    const expectedYears = yearsForLifeCycle(lifeCycle);
    if (lifeCycleYears === expectedYears) return;
    onSave(
      { life_cycle: lifeCycle, life_cycle_years: expectedYears },
      { life_cycle: lifeCycle, life_cycle_years: lifeCycleYears },
      "life cycle years",
    );
    // `onSave` (usePlantAutosave's savePatch) is a fresh closure every
    // PlantDetail render, so listing it here means this effect re-runs on
    // every render, not just a genuine prop change - harmless, since the
    // `lifeCycleYears === expectedYears` guard above makes every run after
    // the first correction a no-op until the props actually change again
    // (navigation to another plant, or an Undo).
  }, [lifeCycle, lifeCycleYears, onSave]);

  function commitLifeCycle(nextCycle: LifeCycle) {
    let nextYears = lifeCycleYears;
    if (nextCycle === "annual" || nextCycle === "biennial") {
      nextYears = yearsForLifeCycle(nextCycle);
    } else if (lifeCycleYears === 1 || lifeCycleYears === 2) {
      // Switching away from annual/biennial - that fixed year count no
      // longer applies, so clear it; the user can still type a specific
      // 3+ years for perennial, or leave it empty.
      nextYears = null;
    }
    if (nextCycle === lifeCycle && nextYears === lifeCycleYears) return;
    onSave(
      { life_cycle: nextCycle, life_cycle_years: nextYears },
      { life_cycle: lifeCycle, life_cycle_years: lifeCycleYears },
      "life cycle",
    );
  }

  function commitYears() {
    if (yearsDraft === lifeCycleYears) return;
    const nextCycle = lifeCycleForYears(yearsDraft) ?? lifeCycle;
    onSave(
      { life_cycle: nextCycle, life_cycle_years: yearsDraft },
      { life_cycle: lifeCycle, life_cycle_years: lifeCycleYears },
      "life cycle years",
    );
  }

  return (
    <>
      {/* #213: explicit htmlFor/id overrides implicit label association
          entirely, so FieldHint's own <button> (rendered before the real
          control) no longer steals it. */}
      <label className="flex flex-col gap-1" htmlFor="plant-field-life_cycle">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          Life cycle
          <FieldHint description="Whether this plant completes its life in one season (annual), two (biennial), or lives on for several years (perennial)." />
        </span>
        <Select
          id="plant-field-life_cycle"
          value={lifeCycle ?? ""}
          onChange={(e) => commitLifeCycle((e.target.value || null) as LifeCycle)}
        >
          <option value="">—</option>
          {LIFE_CYCLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1" htmlFor="plant-field-life_cycle_years">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          Life cycle years (productive lifespan)
          <FieldHint description="How many years this plant stays productive - fixed at 1 for annual and 2 for biennial, free-form for perennial." />
        </span>
        <Input
          id="plant-field-life_cycle_years"
          type="number"
          value={yearsDraft === null || yearsDraft === undefined ? "" : String(yearsDraft)}
          onChange={(e) => setYearsDraft(e.target.value === "" ? null : Number(e.target.value))}
          onBlur={commitYears}
        />
      </label>
    </>
  );
}
