import type { PlantDetail, PlantUpdate } from "@/api/client";

export type FieldType = "text" | "textarea" | "number" | "select" | "tristate" | "tags";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  key: keyof PlantUpdate;
  label: string;
  type: FieldType;
  options?: SelectOption[];
}

const SUN_LEVEL_OPTIONS: SelectOption[] = [
  { value: "full_sun", label: "Full sun" },
  { value: "half_sun", label: "Half sun" },
  { value: "shadow", label: "Shadow" },
];

/** Exported for `LifeCycleFields`, which renders `life_cycle` alongside
 * `life_cycle_years` (see that component's own doc for why those two don't
 * go through the generic SCALAR_FIELDS loop below like every other field). */
export const LIFE_CYCLE_OPTIONS: SelectOption[] = [
  { value: "annual", label: "Annual" },
  { value: "biennial", label: "Biennial" },
  { value: "perennial", label: "Perennial" },
];

/** Drives the generic field renderer on the plant detail page - one entry
 * per Plant/PlantUpdate scalar field (everything except slug, which is
 * identity, not an editable attribute; edible_parts, handled as its own
 * "tags" field type since it's the one array-valued scalar; and
 * life_cycle/life_cycle_years, whose values are correlated and so are
 * rendered together by the dedicated `LifeCycleFields` component instead of
 * independently through this generic loop - see that component's doc). */
export const SCALAR_FIELDS: FieldConfig[] = [
  { key: "common_name", label: "Common name", type: "text" },
  { key: "botanical_name", label: "Botanical name", type: "text" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "sowing_method", label: "Sowing method", type: "textarea" },
  { key: "spread_cm", label: "Spread (cm)", type: "number" },
  { key: "row_spacing_cm", label: "Row spacing (cm)", type: "number" },
  { key: "height_cm", label: "Height (cm)", type: "number" },
  { key: "sun_level", label: "Sun level", type: "select", options: SUN_LEVEL_OPTIONS },
  { key: "soil_type", label: "Soil type", type: "text" },
  { key: "composting_needs", label: "Composting needs", type: "textarea" },
  { key: "fertilizer_needs", label: "Fertilizer needs", type: "textarea" },
  { key: "needs_wind_cover", label: "Needs wind cover", type: "tristate" },
  { key: "needs_rain_cover", label: "Needs rain cover", type: "tristate" },
  { key: "water_needs", label: "Water needs", type: "text" },
  { key: "family", label: "Family", type: "text" },
  { key: "genus", label: "Genus", type: "text" },
  { key: "min_temperature_c", label: "Min temperature (°C)", type: "number" },
  { key: "max_temperature_c", label: "Max temperature (°C)", type: "number" },
  { key: "days_to_maturity", label: "Days to maturity", type: "number" },
  { key: "soil_ph_min", label: "Soil pH min", type: "number" },
  { key: "soil_ph_max", label: "Soil pH max", type: "number" },
  { key: "is_toxic", label: "Is toxic", type: "tristate" },
  { key: "toxicity_notes", label: "Toxicity notes", type: "text" },
  { key: "is_edible", label: "Is edible", type: "tristate" },
  { key: "edible_parts", label: "Edible parts", type: "tags" },
  { key: "succession_enabled", label: "Succession enabled", type: "tristate" },
  { key: "succession_interval_days", label: "Succession interval (days)", type: "number" },
  { key: "succession_max_sowings", label: "Succession max sowings", type: "number" },
];

export type FieldValue = string | number | boolean | string[] | null;

// family/genus read as nested {id, name} objects (real Family/Genus rows -
// see backend/app/models/plant.py) but are edited/committed as plain name
// strings (PlantUpdate.family/genus resolve the name via find-or-create) -
// unwrap to the name for display here, same as every other text field.
const RELATION_FIELDS = new Set(["family", "genus"]);

export function fieldValue(plant: PlantDetail, key: keyof PlantUpdate): FieldValue {
  if (RELATION_FIELDS.has(key as string)) {
    const rel = (plant as unknown as Record<string, { name: string } | null>)[key as string];
    return rel?.name ?? null;
  }
  return (plant as unknown as Record<string, FieldValue>)[key] ?? null;
}
