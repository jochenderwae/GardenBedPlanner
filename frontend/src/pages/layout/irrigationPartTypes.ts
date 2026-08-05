import type { IrrigationPartType } from "@/api/client";

/** `IrrigationPart.part_type` stays deliberately free text (see that
 * model's own backend docstring) rather than a hard FK to `IrrigationPartType.
 * slug` - an exotic/one-off type with no matching row still works, just
 * without a rendered port count/icon. Matching happens here, by normalized
 * string, against both `slug` (machine key, e.g. "t_junction") and `name`
 * (human label, e.g. "T-Junction") - same precedent as `equipmentTypes.ts`'s
 * `findEquipmentType`/`normalizeKey` for `BedEquipment.equipment_type`. */
export function normalizePartTypeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Finds the `IrrigationPartType` whose `slug` or `name` best matches an
 * `IrrigationPart.part_type` free-text value, or `undefined` if nothing
 * matches - callers fall back to the pre-#252 heuristic anchor count in that
 * case (see `PipeNetworkDialog.tsx`'s `anchorCountFor`, #208's analogous
 * `EquipmentType` fallback). */
export function findIrrigationPartType(partTypeText: string, types: IrrigationPartType[]): IrrigationPartType | undefined {
  const key = normalizePartTypeKey(partTypeText);
  if (!key) return undefined;
  return types.find((t) => normalizePartTypeKey(t.slug) === key || normalizePartTypeKey(t.name) === key);
}
