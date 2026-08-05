import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type { BedEquipment, EquipmentCondition } from "@/api/client";

/** #225's own `condition` (good/damaged/retired, defaulting to good) -
 * shared between `EquipmentPanel.tsx` (the canvas editor's Equipment tab)
 * and `Equipment.tsx` (the standalone inventory page) rather than
 * duplicated, same "shared helper" precedent those two already establish
 * for `DEFAULT_EQUIPMENT_SIZE_CM`/`findEquipmentType` (#244). */
export const CONDITION_LABELS: Record<EquipmentCondition, string> = {
  good: "Good",
  damaged: "Damaged",
  retired: "Retired",
};

const CONDITION_BADGE_CLASSES: Record<EquipmentCondition, string> = {
  good: "bg-muted text-muted-foreground",
  // Same amber/destructive pill convention SeedGuideView.tsx's own
  // URGENCY_CLASSES already establishes for "needs attention" vs. "urgent"
  // states.
  damaged: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  retired: "bg-destructive/10 text-destructive",
};

/** A piece of equipment's condition, as a pill - omitted entirely for
 * "good" (the default every pre-#225 row still has, and the common case
 * going forward) so the badge only ever draws the eye to something that
 * actually needs it: a damaged/retired item isn't real "available stock"
 * (see this module's own #244 backlog note). */
export function ConditionBadge({ condition }: { condition: EquipmentCondition }) {
  if (condition === "good") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONDITION_BADGE_CLASSES[condition]}`}>
      {CONDITION_LABELS[condition]}
    </span>
  );
}

/** The unplace flow's own condition picker + trigger (#244) - lets the
 * gardener record what condition a piece of equipment is in *as it's
 * unplaced* (defaulting to "good" if they don't touch it), per
 * `product-owner/research/user-journeys-dave.md`'s "Clearing and pruning"
 * touchpoint ("marking one trellis as returned to stock, marked the other
 * one as 'to trash' since it's broken"). Owns its own local `condition`
 * state (not lifted to the parent list) since it's scoped to a single
 * in-progress unplace action, discarded once the mutation fires - the next
 * time this same item gets unplaced (if ever re-placed first) starts fresh
 * at "good" again, same one-shot spirit as a form field that resets after
 * submit. */
export function UnplaceControl({
  item,
  onReturnToInventory,
}: {
  item: BedEquipment;
  onReturnToInventory: (item: BedEquipment, condition: EquipmentCondition) => void;
}) {
  const [condition, setCondition] = useState<EquipmentCondition>("good");
  return (
    <div className="flex items-center gap-1">
      <Select
        className="h-7 w-24 text-xs"
        aria-label={`Condition when unplacing ${item.equipment_type}`}
        value={condition}
        onChange={(e) => setCondition(e.target.value as EquipmentCondition)}
      >
        {(Object.keys(CONDITION_LABELS) as EquipmentCondition[]).map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABELS[c]}
          </option>
        ))}
      </Select>
      <Tooltip content="Return to inventory">
        <Button variant="ghost" size="sm" onClick={() => onReturnToInventory(item, condition)}>
          Unplace
        </Button>
      </Tooltip>
    </div>
  );
}
