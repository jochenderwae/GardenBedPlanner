import type { PlantDetail, PlantUpdate } from "@/api/client";

export type FieldType = "text" | "textarea" | "number" | "select" | "tristate" | "multiselect";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  key: keyof PlantUpdate;
  label: string;
  type: FieldType;
  options?: SelectOption[];
  /** Tooltip text (native `title` attribute) shown on the field's label,
   * explaining what it represents - matching the pattern the "Tooltips on
   * every input field" backlog item established for the bed/garden/
   * equipment editing panels (see `BedPanel.tsx`). Generated once per field
   * here rather than repeated per-instance in `FieldInput.tsx`. */
  description: string;
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

/** Canonical edible-parts categories - matches the enum in
 * `data/plant.schema.json`'s `edible_parts` field (the data-engineer-owned
 * source of truth the plant-database ETL validates against). Drives the
 * "multiselect" rendering path in `FieldInput.tsx`, replacing the old
 * comma-separated free-text "tags" input for this field. */
export const EDIBLE_PARTS_OPTIONS: SelectOption[] = [
  { value: "fruit", label: "Fruit" },
  { value: "leaves", label: "Leaves" },
  { value: "roots", label: "Roots" },
  { value: "tubers", label: "Tubers" },
  { value: "bulbs", label: "Bulbs" },
  { value: "stems", label: "Stems" },
  { value: "seeds", label: "Seeds" },
  { value: "flowers", label: "Flowers" },
  { value: "pods", label: "Pods" },
  { value: "shoots", label: "Shoots" },
];

/** Drives the generic field renderer on the plant detail page - one entry
 * per Plant/PlantUpdate scalar field (everything except slug, which is
 * identity, not an editable attribute; and life_cycle/life_cycle_years,
 * whose values are correlated and so are rendered together by the
 * dedicated `LifeCycleFields` component instead of independently through
 * this generic loop - see that component's doc). edible_parts is still
 * part of this loop but uses the "multiselect" field type (the one
 * array-valued scalar) rather than a plain scalar type. */
export const SCALAR_FIELDS: FieldConfig[] = [
  { key: "common_name", label: "Common name", type: "text", description: "The plant's everyday name, e.g. 'Tomato'." },
  {
    key: "botanical_name",
    label: "Botanical name",
    type: "text",
    description: "The scientific (Latin binomial) name, e.g. 'Solanum lycopersicum'.",
  },
  { key: "description", label: "Description", type: "textarea", description: "General notes about this plant." },
  {
    key: "sowing_method",
    label: "Sowing method",
    type: "textarea",
    description: "How this plant is typically sown, e.g. direct sow, or start indoors and transplant.",
  },
  {
    key: "spread_cm",
    label: "Spread (cm)",
    type: "number",
    description: "How wide a mature plant spreads, in centimeters.",
  },
  {
    key: "row_spacing_cm",
    label: "Row spacing (cm)",
    type: "number",
    description: "Recommended spacing between rows, in centimeters.",
  },
  { key: "height_cm", label: "Height (cm)", type: "number", description: "Typical mature height, in centimeters." },
  {
    key: "growth_habit",
    label: "Growth habit",
    type: "text",
    description:
      "How this plant grows, e.g. upright, spreading, climbing, rosette, tree - free text, but upright/spreading/climbing/rosette/tree are the values the layout editor recognizes to pick a distinct footprint shape.",
  },
  {
    key: "sun_level",
    label: "Sun level",
    type: "select",
    options: SUN_LEVEL_OPTIONS,
    description: "How much direct sun this plant needs.",
  },
  {
    key: "soil_type",
    label: "Soil type",
    type: "text",
    description: "Preferred soil type, e.g. loam, sandy, well-drained.",
  },
  {
    key: "composting_needs",
    label: "Composting needs",
    type: "textarea",
    description: "Compost/organic matter this plant needs before or during growing.",
  },
  {
    key: "fertilizer_needs",
    label: "Fertilizer needs",
    type: "textarea",
    description: "Fertilizer requirements for this plant.",
  },
  {
    key: "needs_wind_cover",
    label: "Needs wind cover",
    type: "tristate",
    description: "Whether this plant needs protection from wind.",
  },
  {
    key: "needs_rain_cover",
    label: "Needs rain cover",
    type: "tristate",
    description: "Whether this plant needs protection from rain.",
  },
  {
    key: "water_needs_mm_per_week",
    label: "Water needs (mm/week)",
    type: "number",
    description: "How much water this plant typically needs per week, in millimeters.",
  },
  {
    key: "family",
    label: "Family",
    type: "text",
    description: "The botanical family this plant belongs to, e.g. Solanaceae - used for succession/rotation warnings.",
  },
  { key: "genus", label: "Genus", type: "text", description: "The botanical genus this plant belongs to." },
  {
    key: "min_temperature_c",
    label: "Min temperature (°C)",
    type: "number",
    description: "Minimum temperature this plant tolerates, in degrees Celsius.",
  },
  {
    key: "max_temperature_c",
    label: "Max temperature (°C)",
    type: "number",
    description: "Maximum temperature this plant tolerates, in degrees Celsius.",
  },
  {
    key: "days_to_maturity",
    label: "Days to maturity",
    type: "number",
    description: "Typical number of days from sowing/planting to harvest.",
  },
  { key: "soil_ph_min", label: "Soil pH min", type: "number", description: "Minimum preferred soil pH." },
  { key: "soil_ph_max", label: "Soil pH max", type: "number", description: "Maximum preferred soil pH." },
  { key: "is_toxic", label: "Is toxic", type: "tristate", description: "Whether any part of this plant is toxic." },
  {
    key: "toxicity_notes",
    label: "Toxicity notes",
    type: "text",
    description: "Details about which parts are toxic and to whom.",
  },
  { key: "is_edible", label: "Is edible", type: "tristate", description: "Whether this plant is edible." },
  {
    key: "edible_parts",
    label: "Edible parts",
    type: "multiselect",
    options: EDIBLE_PARTS_OPTIONS,
    description: "Which parts of the plant are eaten, e.g. fruit, leaves, roots.",
  },
  {
    key: "succession_enabled",
    label: "Succession enabled",
    type: "tristate",
    description: "Whether this plant supports succession (staggered repeat) sowing.",
  },
  {
    key: "succession_interval_days",
    label: "Succession interval (days)",
    type: "number",
    description: "Days to wait between successive sowings.",
  },
  {
    key: "succession_max_sowings",
    label: "Succession max sowings",
    type: "number",
    description: "Maximum number of succession sowings per season.",
  },
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
