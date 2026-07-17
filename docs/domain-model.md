# Domain Model

This database uses the metric system. When importing data - especially from US databases, take care of conversions from imperial to metric.

## Plants
Let's start with copying the data structure from https://github.com/thefullnacho/openfarm-crops-rescue

Plants have a common name, a botanical name and a description. Add a slug as well for easy linking. Planting data should contain the sowing method, spread, row spacing, height, companions (with a good or bad indicator - do they strengthen each other or compete) and special bedding needs (like strawberries need ground cover to protect the fruit, asparagus and potatoes need hilling, ...). Also include the planting environment: sun level (full sun, half sun, shadow), soil type, composting and fertilizer needs, whether it needs to be covered from wind or rain, water / watering needs. For each plant, also keep a log of where data came from both for attribution and fact-checking. Seed information is also recorded, like the number of seeds per gram, if any special treatment of the seeds is needed prior to sowing (like cooling) and if the plant will produce usable seeds (or not in the case of F1-hybrids, ...). Sowing, planting, fertilization and harvesting happen in specific periods depending on each species, these also need to be recorded.

## Seed inventory
There is an inventory of seeds. Each inventory item links to a plant definition. Seed inventory can be recorded in number of seeds or weight.

## Planting beds
Definition of a planting bed: a section in the garden that has a clear border, on which vegetables can be planted. The border of the planting bed can be a rectangle or a polygon. It has an orientation (indicating north), size (cross-check with border) and height and a ground-level or raised property. Also include soil type, sun level and composting / fertilization information and whether it is inside a greenhouse (or greenhouse-like construction). Also link to a composting / fertilization log.

Planting beds can also have plants placed on them. Some plants can be modeled individually, others are modeled as rows or fields. The choice is up to the user, based on personal preferences and the size of the field / planting bed.

## Planting Bed Equipment
Each planting bed can also contain "equipment" to aid plants, like (drip) irrigation, trellises, plant support, ...

Planting bed equipment has polygon geometry. The geometry can have a surface but can also be line based, it also has a height. In the case of (drip) irrigation, you should also be able to specify the amount of water it delivers. The irrigation system needs more thought though: do we want to map out the complete pipe network as well? Perhaps it is interesting as an input to a control system for valves on the network...

When not placed on a planting bed, equipment is in inventory.

## Garden plan
You need to be able to plan the growing season: what vegetables does the user want to plant / harvest. The plan will give rise to actions / tasks on the calendar like composting, sowing, planting, harvesting, clearing, ...

## Calendar
A calendar based view on all the actions or tasks that need to be performed. The calendar (as a visual component) can also show the sowing and harvesting periods of the plants in the garden plan

## Actions
The garden plan and calendar can link to actions that need to be performed like fertilizing, adding compost, preparing beds, sowing, planting, installing or removing equipment, harvesting, clearing, collecting seeds, ...

## Garden settings
Here data like climate and other overarching data can be stored.
