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

## Planting Bed Equipment
Each planting bed can also contain "equipment" to aid plants, like (drip) irrigation, trellises, plant support, ...

Planting bed equipment has polygon geometry. The geometry can have a surface but can also be line based, it also has a height. In the case of (drip) irrigation, you should also be able to specify the amount of water it delivers.

**Resolved (2026-07-29, #36/#37/#140):** yes, the complete drip irrigation pipe network is mapped out. `IrrigationPart` tracks owned parts at the catalog level (nozzles, T-junctions, connectors, valves, hose segments - one row per distinct part type, not per physical item), `IrrigationConnection` is a flat edge list recording which parts physically connect to which, and `IrrigationZone` groups placed `BedEquipment` rows that share a water source/valve so the watering setup can be planned/queried per zone. See `docs/schema.md`'s `IRRIGATION_PART`/`IRRIGATION_CONNECTION`/`IRRIGATION_ZONE` entities. No control-system/valve-automation input exists yet - that idea is still just a "perhaps interesting" note, not built or currently planned.

When not placed on a planting bed, equipment is in inventory.

## Garden plan
You need to be able to plan the growing season: what vegetables does the user want to plant / harvest. The plan will give rise to actions / tasks on the calendar like composting, sowing, planting, harvesting, clearing, ...

## Calendar
A calendar based view on all the actions or tasks that need to be performed. The calendar (as a visual component) can also show the sowing and harvesting periods of the plants in the garden plan

## Actions
The garden plan and calendar can link to actions that need to be performed like fertilizing, adding compost, preparing beds, sowing, planting, installing or removing equipment, harvesting, clearing, collecting seeds, ...

## Harvest logs
A log of what was harvested, when, and how it went - yield amount/unit (free text, since produce is measured too many different ways: weight for tomatoes, count for peppers, bunches for herbs), a coarse quality rating (poor/fair/good/excellent), and notes - to inform next year's planning (see root `CLAUDE.md`'s domain notes). Each entry links to a specific planting instance, not just a bed, so a per-crop yield history survives multiple different plantings occupying the same bed over time. Not part of the original data model sketch above - added later (`HarvestLog`, see `docs/schema.md`'s `HARVEST_LOG` entity), documented here for completeness.

## Compost bins
Compost-bin-specific state (fill state - empty/filling/full/curing, last-turned date, a gardener-set maturity estimate) for whichever beds are actually compost bins - kept as its own small satellite entity linked 1:1 to a bed rather than as columns on the bed itself, since a bed's own category is deliberately open-ended/free-text and these fields only ever apply to the subset of beds that are compost bins. Not part of the original data model sketch above - added later (`CompostBin`, see `docs/schema.md`'s `COMPOST_BIN` entity), documented here for completeness.

## Garden settings
Here data like climate and other overarching data can be stored.

**As implemented:** folded into the `Garden` entity itself rather than kept as a separate table - both are singleton/overarching concerns about the one garden, so a second always-one-row table alongside it would just be a 1:1 split with no independent lifecycle. `Garden` also carries `orientation_deg` (compass bearing in degrees, 0-360), which bed-rotation and shade-casting reasoning are computed relative to.
