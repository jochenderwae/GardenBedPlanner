import { describe, expect, it } from "vitest";
import type { Action, Planting } from "@/api/client";
import { harvestDisabledReason, resolveHarvestPlanting } from "./harvestPlanting";

function makeAction(overrides: Partial<Action>): Action {
  return {
    id: 1,
    action_type: "harvest",
    due_date_start: null,
    due_date_end: null,
    completed_date: null,
    status: "pending",
    garden_plan_entry_id: null,
    bed_id: 1,
    plant_slug: "tomato",
    equipment_id: null,
    depends_on_action_id: null,
    notes: "",
    ...overrides,
  } as Action;
}

function makePlanting(overrides: Partial<Planting>): Planting {
  return {
    id: 1,
    bed_id: 1,
    plant_slug: "tomato",
    placement_type: "individual",
    geometry: { type: "rectangle", x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    planted_date: null,
    removed_date: null,
    spacing_cm: null,
    ...overrides,
  } as Planting;
}

describe("resolveHarvestPlanting", () => {
  it("resolves the one active planting matching the action's bed+plant", () => {
    const action = makeAction({ bed_id: 1, plant_slug: "tomato" });
    const plantings = [
      makePlanting({ id: 1, bed_id: 1, plant_slug: "tomato" }),
      makePlanting({ id: 2, bed_id: 1, plant_slug: "basil" }),
      makePlanting({ id: 3, bed_id: 2, plant_slug: "tomato" }),
    ];
    const { planting, matchCount } = resolveHarvestPlanting(plantings, action);
    expect(matchCount).toBe(1);
    expect(planting?.id).toBe(1);
  });

  it("excludes an already-removed planting", () => {
    const action = makeAction({ bed_id: 1, plant_slug: "tomato" });
    const plantings = [makePlanting({ id: 1, bed_id: 1, plant_slug: "tomato", removed_date: "2026-01-01" })];
    const { planting, matchCount } = resolveHarvestPlanting(plantings, action);
    expect(matchCount).toBe(0);
    expect(planting).toBeNull();
  });

  it("returns matchCount 0 and no planting when nothing matches", () => {
    const action = makeAction({ bed_id: 1, plant_slug: "tomato" });
    const { planting, matchCount } = resolveHarvestPlanting([], action);
    expect(matchCount).toBe(0);
    expect(planting).toBeNull();
  });

  it("returns matchCount 2+ and no planting for the multi-match edge case", () => {
    const action = makeAction({ bed_id: 1, plant_slug: "tomato" });
    const plantings = [
      makePlanting({ id: 1, bed_id: 1, plant_slug: "tomato" }),
      makePlanting({ id: 2, bed_id: 1, plant_slug: "tomato" }),
    ];
    const { planting, matchCount } = resolveHarvestPlanting(plantings, action);
    expect(matchCount).toBe(2);
    expect(planting).toBeNull();
  });
});

describe("harvestDisabledReason", () => {
  it("is null for exactly one match", () => {
    expect(harvestDisabledReason(1)).toBeNull();
  });

  it("explains the zero-match case", () => {
    expect(harvestDisabledReason(0)).toMatch(/already been cleared/);
  });

  it("explains the multi-match case", () => {
    expect(harvestDisabledReason(2)).toMatch(/Can't tell which planting/);
  });
});
