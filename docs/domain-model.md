# Domain Model

This database uses the metric system. When importing data - especially from US databases, take care of conversions from imperial to metric.

## Plants
Let's start with copying the data structure from https://github.com/thefullnacho/openfarm-crops-rescue

Plants have a common name, a botanical name and a description. Add a slug as well for easy linking. Planting data should contain the sowing method, spread, row spacing, height, companions (with a good or bad indicator - do they strengthen each other or compete) and special bedding needs (like strawberries need ground cover to protect the fruit, asparagus and potatoes need hilling, ...). Also include the planting environment: sun level (full sun, half sun, shadow), soil type, composting and fertilizer needs, whether it needs to be covered from wind or rain, water / watering needs. For each plant, also keep a log of where data came from both for attribution and fact-checking. Seed information is also recorded, like the number of seeds per gram, if any special treatment of the seeds is needed prior to sowing (like cooling) and if the plant will produce usable seeds (or not in the case of F1-hybrids, ...). Sowing, planting, fertilization and harvesting happen in specific periods depending on each species, these also need to be recorded.

## Seed inventory
There is an inventory of seeds. Each inventory item links to a plant definition. Seed inventory can be recorded in number of seeds or weight.

## Planting beds
Definition of a planting bed: a section in the garden that has a clear border, on which vegetables can be planted. The border of the planting bed can be a rectangle or a polygon. It has a size (cross-check with border) and height. Also include soil type, sun level and composting / fertilization information and whether it is inside a greenhouse (or greenhouse-like construction). Also link to a composting / fertilization log.

**As implemented:** a bed's own compass "orientation (indicating north)" and a stored ground-level/raised flag were both dropped in favor of deriving them - orientation comes from the whole garden's `orientation_deg` plus the bed's own geometry rotation (a garden-relative "which way is north" answer instead of a redundant per-bed label, once bed rotation became garden-relative), and "raised" is just `height_cm > 0` rather than a separately-settable flag that could disagree with the bed's own height. See `docs/schema.md`'s `PLANTING_BED`/`GARDEN` entities and its "Modeling decisions worth revisiting" notes.

Planting beds can also have plants placed on them. Some plants can be modeled individually, others are modeled as rows or fields. The choice is up to the user, based on personal preferences and the size of the field / planting bed.

**Added later (2026-08, #150/#265):** a `row`/`field` placement can override the plant's own default spacing per-placement rather than always using its species-level default - `spacing_cm` for the in-row axis, `row_spacing_cm` for the row axis on `field` placements specifically. Both default to null (use the plant's own `spread_cm`/`row_spacing_cm`). See `docs/schema.md`'s `PLANTING` entity.

## Planting Bed Equipment
Each planting bed can also contain "equipment" to aid plants, like (drip) irrigation, trellises, plant support, ...

Planting bed equipment has polygon geometry. The geometry can have a surface but can also be line based, it also has a height. In the case of (drip) irrigation, you should also be able to specify the amount of water it delivers.

**Resolved (2026-07-29, #36/#37/#140):** yes, the complete drip irrigation pipe network is mapped out. `IrrigationPart` tracks owned parts at the catalog level (nozzles, T-junctions, connectors, valves, hose segments - one row per distinct part type, not per physical item), `IrrigationConnection` is a flat edge list recording which parts physically connect to which, and `IrrigationZone` groups placed `BedEquipment` rows that share a water source/valve so the watering setup can be planned/queried per zone. See `docs/schema.md`'s `IRRIGATION_PART`/`IRRIGATION_CONNECTION`/`IRRIGATION_ZONE` entities. No control-system/valve-automation input exists yet - that idea is still just a "perhaps interesting" note, not built or currently planned.

**Refined later (2026-08, #251/#254):** owning more than one physical unit of the same part (e.g. two identical T-junctions wired into different parts of the network) needed its own diagram position and connections, so per-instance placement/connection data was split out of `IrrigationPart` into a new `IrrigationPartInstance` (`IrrigationConnection` now links two instances, not two parts) - `IrrigationPart` itself stays purely catalog/stock ("I own 6 of these"). A seeded, vendor-groupable reference catalog for real-world part shapes (`ResourcePack`/`IrrigationPartType`, the irrigation equivalent of `EquipmentType` below) was also added, letting a vendor's whole parts catalog be toggled visible/hidden as a pack. See `docs/schema.md`'s `IRRIGATION_PART_INSTANCE`/`RESOURCE_PACK`/`IRRIGATION_PART_TYPE` entities.

When not placed on a planting bed, equipment is in inventory.

**Added later (2026-08, #225):** each equipment item also tracks a `condition` (good/damaged/retired) - what happened to it the last time it was unplaced from a bed, so a broken item isn't silently offered back as available stock. Not part of the original description above - documented here for completeness. See `docs/schema.md`'s `BED_EQUIPMENT` entity.

**Added later (2026-08, #255):** equipment can also be placed before it's actually been bought (`owned=false` - a plan to place one, not a physical item yet), the `BedEquipment` counterpart to the "needs purchase" allowance irrigation parts already had. A single `GET /api/shopping-list` endpoint aggregates every current shortfall - unowned equipment plus irrigation parts with more placed instances than stock on hand - into one list; it's a computed read view, not its own stored table. See `docs/schema.md`'s "Modeling decisions worth revisiting" for both.

## Decorations
Not part of the original data model sketch above - added later (2026-08, #241). A purely cosmetic garden object (a path, bench, garden gnome, etc.) with a name, a user-chosen render color, and a drawn rectangle/polygon footprint - no functional data or app behavior otherwise, distinct from `Bed`/`BedEquipment`. See `docs/schema.md`'s `DECORATION` entity (and its own note there flagging a real gap: decorations aren't yet scoped per-garden the way beds are, unlike what multi-garden support below would suggest).

## Multiple gardens
Not part of the original data model sketch above - added later (2026-08, #238). Exactly one `Garden` is "active" at a time; beds and garden plans optionally belong to a specific garden (`garden_id`), resolved to whichever garden is active when not supplied explicitly. Lets a user model more than one physical garden/plot (e.g. a home garden and an allotment) without the app assuming there's only ever one. See `docs/schema.md`'s "Modeling decisions worth revisiting" for the full reasoning, including what still keys off `bed_id` transitively rather than a direct `garden_id`.

## Soil rotation
Not part of the original data model sketch above - added later (2026-08, #228/#229). Some gardeners don't practice crop rotation between fixed beds the way this domain model's "Garden plan"/family-based rotation logic (see root `CLAUDE.md`'s domain notes) assumes - instead, they physically move topsoil between beds every few years, in a cycle that isn't necessarily a closed loop or a simple pairwise swap. A logged "moving day" (`SoilRotationEvent`) records however many bed-to-bed soil transfers it involved (`SoilRotationTransfer`, with a nullable source for "filled with fresh/external soil" rather than moved from another tracked bed); the family-risk history that soil carries with it is copied forward at that point (`SoilFamilyHistory`) so rotation warnings stay accurate for soil that's physically moved, not just for a bed that's stayed planted with the same family repeatedly. See `docs/schema.md`'s `SOIL_ROTATION_EVENT`/`SOIL_ROTATION_TRANSFER`/`SOIL_FAMILY_HISTORY` entities.

## Garden plan
You need to be able to plan the growing season: what vegetables does the user want to plant / harvest. The plan will give rise to actions / tasks on the calendar like composting, sowing, planting, harvesting, clearing, ...

## Calendar
A calendar based view on all the actions or tasks that need to be performed. The calendar (as a visual component) can also show the sowing and harvesting periods of the plants in the garden plan

## Actions
The garden plan and calendar can link to actions that need to be performed like fertilizing, adding compost, preparing beds, sowing, planting, installing or removing equipment, harvesting, clearing, collecting seeds, ...

**Added later (2026-08):** actions can be snoozed (#230, `snoozed_until` - suppresses further reminder pushes until a set date, without changing the task's actual due window) and, for manually-created tasks, made to recur on a schedule (#226, `recurrence_unit`/`recurrence_interval`/`recurrence_end_date` - e.g. "turn the compost bin every 3 weeks"; a completed occurrence generates the next one, linked back via `recurrence_source_action_id`, kept distinct from the existing `depends_on_action_id` predecessor link). Neither was part of the original description above - documented here for completeness. See `docs/schema.md`'s `ACTION` entity.

## Harvest logs
A log of what was harvested, when, and how it went - yield amount/unit (free text, since produce is measured too many different ways: weight for tomatoes, count for peppers, bunches for herbs), a coarse quality rating (poor/fair/good/excellent), and notes - to inform next year's planning (see root `CLAUDE.md`'s domain notes). Each entry links to a specific planting instance, not just a bed, so a per-crop yield history survives multiple different plantings occupying the same bed over time. Not part of the original data model sketch above - added later (`HarvestLog`, see `docs/schema.md`'s `HARVEST_LOG` entity), documented here for completeness.

## Compost bins
Compost-bin-specific state (fill state - empty/filling/full/curing, last-turned date, a gardener-set maturity estimate) for whichever beds are actually compost bins - kept as its own small satellite entity linked 1:1 to a bed rather than as columns on the bed itself, since a bed's own category is deliberately open-ended/free-text and these fields only ever apply to the subset of beds that are compost bins. Not part of the original data model sketch above - added later (`CompostBin`, see `docs/schema.md`'s `COMPOST_BIN` entity), documented here for completeness.

## Garden settings
Here data like climate and other overarching data can be stored.

**As implemented:** folded into the `Garden` entity itself rather than kept as a separate table - both are singleton/overarching concerns about the one garden, so a second always-one-row table alongside it would just be a 1:1 split with no independent lifecycle. `Garden` also carries `orientation_deg` (compass bearing in degrees, 0-360), which bed-rotation and shade-casting reasoning are computed relative to.
