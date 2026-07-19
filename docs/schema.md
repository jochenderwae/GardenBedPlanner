# Schema

Entity-relationship diagram derived from [`domain-model.md`](./domain-model.md). This is a planning sketch, not a source of truth for the actual SQLModel/Alembic schema — reconcile the two as models are implemented.

```mermaid
erDiagram
    PLANT {
        string slug PK
        string common_name
        string botanical_name
        string description
        string sowing_method
        float spread_cm
        float row_spacing_cm
        float height_cm
        string sun_level "full sun | half sun | shadow"
        string soil_type
        string composting_needs
        string fertilizer_needs
        boolean needs_wind_cover
        boolean needs_rain_cover
        string water_needs
        string family "taxonomic - for rotation/succession-family logic"
        string genus
        float min_temperature_c "natural habitat range, not a hardiness zone"
        float max_temperature_c
        int days_to_maturity
        float soil_ph_min
        float soil_ph_max
        boolean is_toxic
        string toxicity_notes
        boolean is_edible
        string edible_parts "array, e.g. fruit, leaves - open-ended"
        boolean succession_enabled
        int succession_interval_days
        int succession_max_sowings
        string life_cycle "annual | biennial | perennial"
        int life_cycle_years "typical productive lifespan, e.g. 7 for raspberries - independent of life_cycle"
    }

    PLANT_DATA_SOURCE {
        int id PK
        string plant_slug FK
        string source_url
        string attribution
        string notes "for fact-checking"
    }

    SEED_INFO {
        string plant_slug PK, FK
        int seeds_per_gram
        string pretreatment "e.g. cold stratification"
        boolean produces_viable_seeds
        boolean is_f1_hybrid
    }

    PLANT_PERIOD {
        int id PK
        string plant_slug FK
        string period_type FK "references period_type.code - lookup table, not a fixed enum"
        int start_month "1-12, recurs yearly - not a calendar date"
        int end_month "1-12, recurs yearly - not a calendar date"
    }

    PERIOD_TYPE {
        string code PK "e.g. sowing, planting, fertilizing, harvesting"
        string description "e.g. Seed sowing window"
    }

    PLANT_COMPANION {
        string plant_slug FK
        string companion_plant_slug FK
        string relationship "good | bad"
        string mechanism "e.g. pest-deterrent, nitrogen-fixing - open-ended"
        string notes
    }

    PLANT_PEST_INTERACTION {
        int id PK
        string plant_slug FK
        string interaction_type "attracts | repels | vulnerable_to"
        string pest_or_insect "free text, e.g. aphids, ladybugs"
        string notes
    }

    PLANT_GROWING_INFORMATION {
        int id PK
        string plant_slug FK
        string text "long-form, unstructured, e.g. a Project Gutenberg book excerpt"
        string source_url
        string attribution "e.g. book title/author"
        string copyright_status "e.g. public domain, CC BY-SA 4.0, unknown"
        string record_type "raw | consolidated, default raw"
        boolean generic_for_species "true if written generically about the species, not this cultivar"
    }

    PLANT_BEDDING_NEED {
        int id PK
        string plant_slug FK
        string need_type "ground_cover | hilling | staking | ..."
        string notes
    }

    SEED_INVENTORY_ITEM {
        int id PK
        string plant_slug FK
        float quantity_seeds
        float weight_grams
        date acquired_date
        string notes
    }

    GARDEN {
        int id PK
        string name
        jsonb border_geometry "rectangle|polygon, garden-space cm - see Geometry format"
        string climate_zone
        string location
        string notes
    }

    PLANTING_BED {
        int id PK
        string name
        string category "free-text - examples of what a bed can be, not a closed type list"
        jsonb border_geometry "rectangle|polygon, garden-space cm - see Geometry format"
        string orientation "north-facing edge, coarse compass label"
        float height_cm
        boolean has_greenhouse
        boolean is_raised
        string soil_type
        string sun_level
        string notes
    }

    PLANTING {
        int id PK
        int bed_id FK "required - open-ground placement uses the auto-created ground bed, not a null bed_id"
        string plant_slug FK
        string placement_type "individual | row | field"
        jsonb geometry "rectangle|polygon, bed-local cm - see Geometry format"
        date planted_date
        date removed_date
    }

    BED_EQUIPMENT {
        int id PK
        int bed_id FK "nullable - null means in inventory"
        string equipment_type "irrigation | trellis | plant_support | ..."
        jsonb geometry "rectangle|polygon, bed-local cm, null if in inventory - see Geometry format"
        float height_cm
        float water_delivery_lph "irrigation only"
    }

    COMPOST_FERTILIZATION_LOG {
        int id PK
        int bed_id FK
        date log_date
        string type "compost | fertilizer"
        string product
        string amount
        string notes
    }

    GARDEN_PLAN {
        int id PK
        string season_name
        int year
        string notes
    }

    GARDEN_PLAN_ENTRY {
        int id PK
        int garden_plan_id FK
        string plant_slug FK
        int bed_id FK "optional - not yet assigned"
        int desired_quantity
        string notes
    }

    ACTION {
        int id PK
        string action_type "fertilize | compost | prepare_bed | sow | plant | install_equipment | remove_equipment | harvest | clear | collect_seeds"
        date due_date
        date completed_date
        string status
        int garden_plan_entry_id FK "optional"
        int bed_id FK "optional"
        string plant_slug FK "optional"
        int equipment_id FK "optional"
        string notes
    }

    PLANT ||--o{ PLANT_DATA_SOURCE : "documented by"
    PLANT ||--o| SEED_INFO : "has"
    PLANT ||--o{ PLANT_PERIOD : "has"
    PERIOD_TYPE ||--o{ PLANT_PERIOD : "classifies"
    PLANT ||--o{ PLANT_BEDDING_NEED : "requires"
    PLANT ||--o{ PLANT_COMPANION : "is subject of"
    PLANT ||--o{ PLANT_COMPANION : "is companion in"
    PLANT ||--o{ PLANT_PEST_INTERACTION : "has"
    PLANT ||--o{ PLANT_GROWING_INFORMATION : "has"
    PLANT ||--o{ SEED_INVENTORY_ITEM : "stocked as"
    PLANT ||--o{ PLANTING : "planted as"
    PLANT ||--o{ GARDEN_PLAN_ENTRY : "planned as"
    PLANT o|--o{ ACTION : "concerns"

    PLANTING_BED ||--o{ PLANTING : "contains"
    PLANTING_BED o|--o{ BED_EQUIPMENT : "hosts"
    PLANTING_BED ||--o{ COMPOST_FERTILIZATION_LOG : "logs"
    PLANTING_BED o|--o{ GARDEN_PLAN_ENTRY : "targeted by"
    PLANTING_BED o|--o{ ACTION : "site of"

    GARDEN_PLAN ||--o{ GARDEN_PLAN_ENTRY : "contains"
    GARDEN_PLAN_ENTRY o|--o{ ACTION : "generates"
    BED_EQUIPMENT o|--o{ ACTION : "concerns"
```

## Geometry format

All geometry fields (`GARDEN.border_geometry`, `PLANTING_BED.border_geometry`, `PLANTING.geometry`, `BED_EQUIPMENT.geometry`) are `jsonb`, holding a small GeoJSON-flavored shape rather than a `geometry`/`geography` PostGIS column or an SVG string — see the discussion above the diagram for why (single-user, no real spatial queries, direct fit with `react-konva`). All units are centimeters; there is no CRS, just a flat local coordinate plane. Implemented as `backend/app/models/geometry.py`'s `Geometry` Pydantic type (a discriminated union, validated at the API boundary — stored as a raw `dict` at the SQLModel table level, same split the rest of this schema already uses for taxonomy FK-in-table/nested-object-in-API).

**Coordinate spaces** — two, matching how Konva nests groups:
- **Garden space** — `GARDEN.border_geometry` and `PLANTING_BED.border_geometry`. Absolute coordinates on the whole-garden canvas, origin `(0, 0)` at a fixed reference point (e.g. the NW corner of the plot). `orientation` stays a separate coarse compass label (N/NE/E/...) for sun/shade reasoning — it's not derived from `rotation`.
- **Bed-local space** — `PLANTING.geometry` and `BED_EQUIPMENT.geometry`. Origin `(0, 0)` at the top-left corner of the bed's bounding box, unrotated. The frontend positions each bed's Konva `Group` using `border_geometry` and renders plantings/equipment as children in that group's local coordinates, so it doesn't have to re-derive offsets.

**Shape types** (discriminated union on `type`):

```ts
type Point2D = { x: number; y: number };

type Geometry =
  | { type: "rectangle"; x: number; y: number; width: number; height: number; rotation?: number }
  | { type: "polygon"; points: Point2D[] };
```

`rotation` (degrees, clockwise, default `0`) only applies to `rectangle` — polygon vertices already encode any rotation directly. **Simplified from this doc's original `point`/`line`/`rectangle`/`polygon` four-variant sketch down to just `rectangle`/`polygon`** when actually implemented — one shared discriminated union across every geometry column (garden/bed borders *and* plantings/equipment) rather than a wider variant set only some columns use. `individual` plantings use a small rectangle centered on the placement point rather than a literal `point` type; `row` placements use a `polygon` rather than a `line`. Every geometry-typed column in the real schema accepts exactly `rectangle | polygon`, no exceptions.

**Which type goes where:**

| Field | Allowed types | Notes |
|---|---|---|
| `GARDEN.border_geometry` | `rectangle`, `polygon` | Rectangle is the default shown in the editor; polygon is an explicit user choice via a shape-type toggle. |
| `PLANTING_BED.border_geometry` | `rectangle`, `polygon` | Same rectangle-default/polygon-toggle convention as `GARDEN`. |
| `PLANTING.geometry` | `rectangle`, `polygon` | `individual` → small rectangle (frontend defaults to a 20cm square, `DEFAULT_PLANTING_DIAMETER_CM`); `row`/`field` → `polygon`. |
| `BED_EQUIPMENT.geometry` | `rectangle`, `polygon` | `null` when `bed_id` is `null` (item is in inventory, not placed) or, in practice, whenever the equipment-placement UI hasn't been given a geometry (that tab is form-based, not drag/resize — see the frontend note below). |

**Examples:**

```json
// GARDEN.border_geometry - the garden's own outer boundary, garden space
{ "type": "rectangle", "x": 20, "y": 20, "width": 500, "height": 500, "rotation": 0 }

// PLANTING_BED.border_geometry - a 70x200cm rectangular planter, in garden space
{ "type": "rectangle", "x": 120, "y": 40, "width": 70, "height": 200, "rotation": 0 }

// PLANTING.geometry - a single tomato plant, individually placed, bed-local
{ "type": "rectangle", "x": 5, "y": 20, "width": 20, "height": 20, "rotation": 0 }

// PLANTING.geometry - a row of carrots as a thin polygon, bed-local
{ "type": "polygon", "points": [{ "x": 5, "y": 8 }, { "x": 65, "y": 8 }, { "x": 65, "y": 12 }, { "x": 5, "y": 12 }] }
```

## Modeling decisions worth revisiting

- `PLANT_COMPANION` is a self-referencing join table on `PLANT`, carrying a `relationship` (good/bad) indicator.
- `SEED_INFO` is split into its own 1:1 entity rather than columns on `PLANT`, since it's a distinct data cluster (seeds/gram, pretreatment, F1 status).
- `PLANT_PERIOD` generalizes sowing/planting/fertilizing/harvesting windows into one table with a `period_type` rather than four separate date-range columns — easier to extend, but explicit columns are an alternative. Implemented as `start_month`/`end_month` integers (1-12), not `date`s as originally sketched here — these are species-level windows that recur every year, not one-off events tied to a specific year (that's what `PLANTING`/`ACTION` dates are for).
- `GARDEN_PLAN_ENTRY` is an inferred join between `GARDEN_PLAN` and `PLANT` (optionally a `PLANTING_BED`) — the domain model describes the plan conceptually but doesn't name this table.
- `ACTION` carries four optional FKs (bed/plant/equipment/plan-entry) rather than a polymorphic target — simplest for SQLModel/Alembic, but gets sparse; a generic `target_type`/`target_id` pair is the alternative if nullable FK sprawl becomes a problem.
- `GARDEN_SETTINGS` is left unlinked (singleton config), per the domain model's vague "overarching data" description. **Folded into `GARDEN` when implemented** (below) rather than kept as a separate table — both are singleton/overarching concerns about the same one garden, so a second always-one-row table alongside `GARDEN` would just be a 1:1 split with no independent lifecycle.
- `PLANTING_BED.width_cm` / `length_cm` were dropped in favor of deriving footprint from `border_geometry` (see [Geometry format](#geometry-format)) — `height_cm` stays since it's a true vertical dimension the 2D geometry can't express.
- **`GARDEN`/`PLANTING_BED`/`PLANTING`/`BED_EQUIPMENT` are now implemented** (`backend/app/models/garden.py`, `bed.py`, `planting.py`, `bed_equipment.py`; migrations `create_garden_table`, `generalize_bed_geometry`, `create_planting_table`, `create_bed_equipment_table`). `PLANTING_BED`'s originally-sketched `bed_type` (a closed 5-value enum: `large_planter`/`small_planter`/`berry_row`/`compost_bin`/`fruit_tree`) shipped first as written, then was replaced by free-text `category` once real usage showed those 5 values were only ever meant as *examples* of what a bed could be, not an exhaustive list — the enum and its Postgres type were dropped in the same migration that added `border_geometry`, not layered alongside it.
- **`GARDEN` has no persisted FK relationship to `PLANTING_BED`** (deliberately not drawn as a relationship line in the diagram above) — the only link between them is a one-time convenience default: the API (`GET`/`PUT /api/garden`, singular, get-or-create semantics) auto-creates one ordinary `PLANTING_BED` row matching the `GARDEN`'s own shape the *first* time a garden is created (`category="Ground"`, `is_raised=false`) — the default "plant directly in the garden" surface, so every `PLANTING.bed_id` can stay required/non-nullable instead of needing a nullable garden-space-vs-bed-local branch. That bed is ordinary afterward — the user can reshape, rename, or delete it like any other, and it is not kept in sync with later edits to the garden's own boundary.
- **The `PLANT` cluster is implemented** — `backend/app/models/plant.py` + the `create_plant_tables` migration. All fields except `slug`/`common_name`/`botanical_name` (and each satellite table's own identity/FK columns) are nullable: this table is meant to be bulk-populated from heterogeneous external sources via the ETL in `data/`, which won't have every field for every plant. Don't assume non-null without checking. The JSON import format that feeds the ETL is `data/plant.schema.json` (JSON Schema), designed to map ~1:1 onto this schema - one JSON object per plant, with `seed_info`/`periods`/`companions`/`pest_interactions`/`bedding_needs`/`data_sources` nested as the satellite-table data.
- **`PLANT` gained a second wave of fields** (`add_taxonomy_climate_succession_fields_and_pest_interactions` migration) after cross-referencing candidate data sources against the original field list: `family`/`genus` (taxonomy - the rotation/succession-family domain note had no field to actually key off before this), `min_temperature_c`/`max_temperature_c` (natural habitat range, chosen over a US hardiness zone since it's directly usable for the Belgium climate-adjustment goal), `days_to_maturity`, `soil_ph_min`/`soil_ph_max` (checked 0-14), `is_toxic`/`toxicity_notes`, `is_edible`/`edible_parts`, and `succession_enabled`/`succession_interval_days`/`succession_max_sowings`. `PLANT_COMPANION` gained `mechanism` (open-ended, e.g. "pest-deterrent"). `PLANT_PEST_INTERACTION` is a new table for plant-to-insect relationships (attracts/repels/vulnerable_to) - deliberately separate from `PLANT_COMPANION`, which is plant-to-plant. Explicitly skipped: a "lunar planting affinity" field seen in one candidate source - folk-practice data, low value for this project.
- **`PLANT_GROWING_INFORMATION`** (`add_plant_growing_information` migration) holds long-form, deliberately *unstructured* text - book excerpts (Project Gutenberg has old gardening books with a section per plant) rather than a discrete field. It's raw material for a not-yet-built extraction pass meant to fill the fields nothing structured covers (`composting_needs`, `fertilizer_needs`, `needs_wind_cover`/`needs_rain_cover`, `seed_info.pretreatment`, `bedding_needs` - see `data/CLAUDE.md`'s "Fields still needing a source"). `record_type` (`raw`/`consolidated`) distinguishes a single source's excerpt from a synthesized combination of several. `generic_for_species` flags text written about the species/genus generally (e.g. old books describing "pumpkins" rather than a specific cultivar) rather than this specific cultivar - the text still gets copied into every matching cultivar's own record (see the `PLANT_COMPANION`/matching note in `data/etl/CLAUDE.md` about why cultivars stay separate records), just marked so it isn't mistaken for cultivar-specific advice. No separate "species" entity was introduced for this - keeping it as a flag on the per-cultivar copy was the simpler option and what was asked for.
- **`PLANT_PERIOD.period_type`** (`convert_period_type_to_lookup_table` migration) - was a fixed 4-value Postgres enum (`sowing`/`planting`/`fertilizing`/`harvesting`), now a FK into a new `PERIOD_TYPE` lookup table (`code` PK + `description`), seeded with those same 4 rows. Plant care needs more period types than can be enumerated up front (e.g. pruning, thinning, mulching), and a fixed enum requires a schema migration for every addition - a lookup table lets a new period type be added as a data insert instead. `data/plant.schema.json`'s `period_type` field is correspondingly a plain string now, not a closed JSON Schema enum (same "resolved at import time" caveat as `companions[].companion_slug`).
- **`PLANT.life_cycle`/`life_cycle_years`** (`add_plant_life_cycle` migration) - `life_cycle` classifies annual/biennial/perennial as usual. `life_cycle_years` is a separate, independent nullable field for a perennial's typical *productive* lifespan (e.g. raspberry canes are perennial but a patch is usually renewed after ~7 years) - deliberately not a 4th `life_cycle` value, since "perennial" and "perennial with a known productive span" aren't mutually exclusive categories. Not yet populated by the ETL for any of the 359 already-exported plants - see `data/CLAUDE.md`'s "Fields still needing a source"; `sources/trefle.py`'s `map_record` doesn't currently pull anything duration/life-cycle-related from `main_species`, worth checking against a real cached response before assuming Trefle has (or lacks) this.
