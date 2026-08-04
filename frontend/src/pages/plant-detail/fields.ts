import type { PlantDetail, PlantUpdate } from "@/api/client";
import { KNOWN_HABITS } from "@/pages/layout/PlantFootprint";

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
  /** "primary" fields render directly under `PlantDetail.tsx`'s identity
   * line; "secondary" fields collapse behind its "Show more details"
   * disclosure (#237's Option A layout) - a one-time everyday-use-frequency
   * judgment call, not a mechanism that varies per plant. Meaningless for
   * `common_name`/`family`/`genus` (still declared here as regular
   * `PlantUpdate` fields, but rendered on the identity line itself via
   * `InlineEditableField` instead of through the generic tiered loop -
   * `PlantDetail.tsx` filters them out of `SCALAR_FIELDS` before tiering). */
  tier: "primary" | "secondary";
}

const SUN_LEVEL_OPTIONS: SelectOption[] = [
  { value: "full_sun", label: "Full sun" },
  { value: "half_sun", label: "Half sun" },
  { value: "shadow", label: "Shadow" },
];

/** #260: `growth_habit` used to be free text, but it only ever means
 * something to the layout editor when it's one of `PlantFootprint.tsx`'s
 * `KNOWN_HABITS` (that's the exact set it normalizes/matches against to
 * pick a footprint shape, falling back to a generic circle otherwise) - so
 * constrain the editor to that same fixed set rather than free text,
 * imported from there rather than re-declared so the two can't drift apart.
 * Confirmed via a real-database check (`SELECT growth_habit, count(*) FROM
 * plant GROUP BY growth_habit`) that every non-null value already on file is
 * one of these five - a plain closed select is safe, no off-list values to
 * preserve. */
const GROWTH_HABIT_LABELS: Record<(typeof KNOWN_HABITS)[number], string> = {
  upright: "Upright",
  spreading: "Spreading",
  climbing: "Climbing",
  rosette: "Rosette",
  tree: "Tree",
};
const GROWTH_HABIT_OPTIONS: SelectOption[] = KNOWN_HABITS.map((habit) => ({ value: habit, label: GROWTH_HABIT_LABELS[habit] }));

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
  // Identity fields (common_name/family/genus) - rendered on PlantDetail's
  // identity line via InlineEditableField, not through the tiered loop
  // below; `tier` is set but unused for these three (see FieldConfig's own
  // doc).
  { key: "common_name", label: "Common name", type: "text", description: "The plant's everyday name, e.g. 'Tomato'.", tier: "primary" },
  {
    key: "botanical_name",
    label: "Botanical name",
    type: "text",
    description: "The scientific (Latin binomial) name, e.g. 'Solanum lycopersicum'.",
    tier: "primary",
  },
  { key: "description", label: "Description", type: "textarea", description: "General notes about this plant.", tier: "primary" },
  {
    key: "sowing_method",
    label: "Sowing method",
    type: "textarea",
    description: "How this plant is typically sown, e.g. direct sow, or start indoors and transplant.",
    tier: "secondary",
  },
  {
    key: "sow_indoors",
    label: "Sow indoors",
    type: "tristate",
    description: "Whether this plant is typically started indoors and transplanted out later.",
    tier: "secondary",
  },
  {
    key: "sow_direct",
    label: "Sow direct",
    type: "tristate",
    description: "Whether this plant is typically sown directly into its final growing spot.",
    tier: "secondary",
  },
  {
    key: "needs_thinning",
    label: "Needs thinning",
    type: "tristate",
    description: "Whether seedlings of this plant typically need thinning out after germination.",
    tier: "secondary",
  },
  {
    key: "spread_cm",
    label: "Spread (cm)",
    type: "number",
    description: "How wide a mature plant spreads, in centimeters.",
    tier: "primary",
  },
  {
    key: "row_spacing_cm",
    label: "Row spacing (cm)",
    type: "number",
    description: "Recommended spacing between rows, in centimeters.",
    tier: "primary",
  },
  { key: "height_cm", label: "Height (cm)", type: "number", description: "Typical mature height, in centimeters.", tier: "primary" },
  {
    key: "growth_habit",
    label: "Growth habit",
    type: "select",
    options: GROWTH_HABIT_OPTIONS,
    description: "How this plant grows - determines the distinct footprint shape the layout editor renders for it.",
    tier: "primary",
  },
  {
    key: "sun_level",
    label: "Sun level",
    type: "select",
    options: SUN_LEVEL_OPTIONS,
    description: "How much direct sun this plant needs.",
    tier: "primary",
  },
  {
    key: "soil_type",
    label: "Soil type",
    type: "text",
    description: "Preferred soil type, e.g. loam, sandy, well-drained.",
    tier: "primary",
  },
  {
    key: "composting_needs",
    label: "Composting needs",
    type: "textarea",
    description: "Compost/organic matter this plant needs before or during growing.",
    tier: "secondary",
  },
  {
    key: "fertilizer_needs",
    label: "Fertilizer needs",
    type: "textarea",
    description: "Fertilizer requirements for this plant.",
    tier: "secondary",
  },
  {
    key: "needs_wind_cover",
    label: "Needs wind cover",
    type: "tristate",
    description: "Whether this plant needs protection from wind.",
    tier: "secondary",
  },
  {
    key: "needs_rain_cover",
    label: "Needs rain cover",
    type: "tristate",
    description: "Whether this plant needs protection from rain.",
    tier: "secondary",
  },
  {
    key: "water_needs_mm_per_week",
    label: "Water needs (mm/week)",
    type: "number",
    description: "How much water this plant typically needs per week, in millimeters.",
    tier: "primary",
  },
  {
    key: "family",
    label: "Family",
    type: "text",
    description: "The botanical family this plant belongs to, e.g. Solanaceae - used for succession/rotation warnings.",
    tier: "primary",
  },
  { key: "genus", label: "Genus", type: "text", description: "The botanical genus this plant belongs to.", tier: "primary" },
  {
    key: "min_temperature_c",
    label: "Min temperature (°C)",
    type: "number",
    description: "Minimum temperature this plant tolerates, in degrees Celsius.",
    tier: "secondary",
  },
  {
    key: "max_temperature_c",
    label: "Max temperature (°C)",
    type: "number",
    description: "Maximum temperature this plant tolerates, in degrees Celsius.",
    tier: "secondary",
  },
  {
    key: "days_to_maturity",
    label: "Days to maturity",
    type: "number",
    description: "Typical number of days from sowing/planting to harvest.",
    tier: "secondary",
  },
  { key: "soil_ph_min", label: "Soil pH min", type: "number", description: "Minimum preferred soil pH.", tier: "secondary" },
  { key: "soil_ph_max", label: "Soil pH max", type: "number", description: "Maximum preferred soil pH.", tier: "secondary" },
  { key: "is_toxic", label: "Is toxic", type: "tristate", description: "Whether any part of this plant is toxic.", tier: "secondary" },
  {
    key: "toxicity_notes",
    label: "Toxicity notes",
    type: "text",
    description: "Details about which parts are toxic and to whom.",
    tier: "secondary",
  },
  { key: "is_edible", label: "Is edible", type: "tristate", description: "Whether this plant is edible.", tier: "secondary" },
  {
    key: "edible_parts",
    label: "Edible parts",
    type: "multiselect",
    options: EDIBLE_PARTS_OPTIONS,
    description: "Which parts of the plant are eaten, e.g. fruit, leaves, roots.",
    tier: "secondary",
  },
  {
    key: "succession_enabled",
    label: "Succession enabled",
    type: "tristate",
    description: "Whether this plant supports succession (staggered repeat) sowing.",
    tier: "secondary",
  },
  {
    key: "succession_interval_days",
    label: "Succession interval (days)",
    type: "number",
    description: "Days to wait between successive sowings.",
    tier: "secondary",
  },
  {
    key: "succession_max_sowings",
    label: "Succession max sowings",
    type: "number",
    description: "Maximum number of succession sowings per season.",
    tier: "secondary",
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
