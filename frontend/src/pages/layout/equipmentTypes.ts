import type { EquipmentType } from "@/api/client";

/** `BedEquipment.equipment_type` stays deliberately free text (see that
 * model's own backend docstring) rather than a hard FK to `EquipmentType.
 * slug` - an exotic/one-off type with no matching row still works, just
 * without a rendered default. Matching happens here, by normalized string,
 * against both `slug` (machine key, e.g. "drip_line") and `name` (human
 * label, e.g. "Drip Line") - the inventory form's own placeholder text
 * ("e.g. trellis, drip line, stake...") nudges users toward space-separated
 * free text, not the underscore-separated slug convention, so matching
 * needs to tolerate that gap rather than requiring an exact slug match. */
function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Finds the `EquipmentType` whose `slug` or `name` best matches a
 * `BedEquipment.equipment_type` free-text value, or `undefined` if nothing
 * matches - callers fall back to the old fixed-size rendering in that case
 * (see `Layout.tsx`'s `handleEquipmentPlace`/`handleEquipmentPlaceInGarden`,
 * #208). */
export function findEquipmentType(equipmentTypeText: string, types: EquipmentType[]): EquipmentType | undefined {
  const key = normalizeKey(equipmentTypeText);
  if (!key) return undefined;
  return types.find((t) => normalizeKey(t.slug) === key || normalizeKey(t.name) === key);
}
