import { describe, expect, it } from "vitest";
import type { Action, Bed, Plant, Planting } from "@/api/client";
import {
  actionDueDate,
  actionsForBedOnly,
  actionsForRow,
  bedIdsWithBedOnlyActions,
  dayFractionInMonth,
  periodBarSegments,
  plantingOverlapsYear,
  timelineRows,
  timelineYears,
  weekOfYear,
  weekRangeForMonths,
} from "./timelineData";

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

function makeAction(overrides: Partial<Action>): Action {
  return {
    id: 1,
    action_type: "sow",
    due_date_start: null,
    due_date_end: null,
    completed_date: null,
    status: "pending",
    garden_plan_entry_id: null,
    bed_id: null,
    plant_slug: null,
    equipment_id: null,
    depends_on_action_id: null,
    notes: "",
    ...overrides,
  } as Action;
}

describe("timelineYears", () => {
  it("always includes the current year even with no dated plantings", () => {
    expect(timelineYears([], "2026-07-28")).toEqual([2026]);
  });

  it("collects every distinct year touched by planted_date/removed_date", () => {
    const plantings = [
      makePlanting({ planted_date: "2024-05-01", removed_date: "2024-09-01" }),
      makePlanting({ planted_date: "2025-03-01", removed_date: null }),
    ];
    expect(timelineYears(plantings, "2026-01-01")).toEqual([2024, 2025, 2026]);
  });
});

describe("plantingOverlapsYear", () => {
  it("is true for a planting with no dates at all (always present)", () => {
    expect(plantingOverlapsYear(makePlanting({}), 2026)).toBe(true);
  });

  it("is true when the planting spans the whole year", () => {
    expect(plantingOverlapsYear(makePlanting({ planted_date: "2025-06-01", removed_date: "2027-01-01" }), 2026)).toBe(true);
  });

  it("is false when removed before the year starts", () => {
    expect(plantingOverlapsYear(makePlanting({ removed_date: "2025-12-31" }), 2026)).toBe(false);
  });

  it("is false when planted after the year ends", () => {
    expect(plantingOverlapsYear(makePlanting({ planted_date: "2027-01-01" }), 2026)).toBe(false);
  });
});

describe("periodBarSegments", () => {
  it("returns one segment for a non-wrapping period", () => {
    expect(periodBarSegments(3, 5)).toEqual([{ startMonth: 3, endMonth: 5 }]);
  });

  it("splits a year-wrapping period into two segments", () => {
    expect(periodBarSegments(11, 2)).toEqual([
      { startMonth: 11, endMonth: 12 },
      { startMonth: 1, endMonth: 2 },
    ]);
  });
});

describe("dayFractionInMonth", () => {
  it("places day 1 near the left edge, not flush against it", () => {
    const frac = dayFractionInMonth("2026-07-01");
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(0.1);
  });

  it("places the last day near the right edge, not flush against it", () => {
    const frac = dayFractionInMonth("2026-07-31");
    expect(frac).toBeGreaterThan(0.9);
    expect(frac).toBeLessThan(1);
  });
});

describe("weekOfYear / weekRangeForMonths", () => {
  it("Jan 1 is week 1", () => {
    expect(weekOfYear("2026-01-01")).toBe(1);
  });

  it("weekRangeForMonths spans the weeks covering the given months", () => {
    const { startWeek, endWeek } = weekRangeForMonths(2026, 1, 1);
    expect(startWeek).toBe(1);
    expect(endWeek).toBe(weekOfYear("2026-01-31"));
  });
});

describe("actionsForRow / actionsForBedOnly", () => {
  const actions = [
    makeAction({ id: 1, bed_id: 7, plant_slug: "tomato" }),
    makeAction({ id: 2, bed_id: 7, plant_slug: "basil" }),
    makeAction({ id: 3, bed_id: 7, plant_slug: null, action_type: "prepare_bed" }),
    makeAction({ id: 4, bed_id: 9, plant_slug: "tomato" }),
  ];

  it("matches on bed_id AND plant_slug", () => {
    expect(actionsForRow(actions, 7, "tomato").map((a) => a.id)).toEqual([1]);
  });

  it("bed-only actions have a bed_id but no plant_slug", () => {
    expect(actionsForBedOnly(actions, 7).map((a) => a.id)).toEqual([3]);
  });
});

describe("actionDueDate", () => {
  it("prefers due_date_end", () => {
    expect(actionDueDate(makeAction({ due_date_start: "2026-01-01", due_date_end: "2026-01-31" }))).toBe("2026-01-31");
  });

  it("falls back to due_date_start", () => {
    expect(actionDueDate(makeAction({ due_date_start: "2026-01-01", due_date_end: null }))).toBe("2026-01-01");
  });

  it("is null with neither date set", () => {
    expect(actionDueDate(makeAction({}))).toBeNull();
  });
});

function makePlant(overrides: Partial<Plant>): Plant {
  return { slug: "tomato", common_name: "Tomato", botanical_name: "Solanum lycopersicum", ...overrides } as Plant;
}

function makeBed(overrides: Partial<Bed>): Bed {
  return { id: 1, name: "Bed A", height_cm: 0, has_greenhouse: false, ...overrides } as Bed;
}

describe("timelineRows", () => {
  const plantsBySlug = new Map([
    ["squash", makePlant({ slug: "squash", common_name: "Acorn squash" })],
    ["tomato", makePlant({ slug: "tomato", common_name: "Tomato" })],
  ]);
  const bedsById = new Map([
    [1, makeBed({ id: 1, name: "Bed A" })],
    [2, makeBed({ id: 2, name: "Bed B" })],
  ]);

  it("groups several plantings of the same species in the same bed onto one row (#233)", () => {
    const plantings = [
      makePlanting({ id: 1, bed_id: 1, plant_slug: "squash", planted_date: "2026-05-01" }),
      makePlanting({ id: 2, bed_id: 1, plant_slug: "squash", planted_date: "2026-05-02" }),
      makePlanting({ id: 3, bed_id: 1, plant_slug: "squash", planted_date: "2026-05-03" }),
    ];
    const rows = timelineRows(plantings, 2026, plantsBySlug, bedsById);
    expect(rows).toHaveLength(1);
    expect(rows[0].plantings.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("keeps the same species in two different beds as two separate rows (per-bed grouping)", () => {
    const plantings = [
      makePlanting({ id: 1, bed_id: 1, plant_slug: "squash" }),
      makePlanting({ id: 2, bed_id: 2, plant_slug: "squash" }),
    ];
    const rows = timelineRows(plantings, 2026, plantsBySlug, bedsById);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.bed.name).sort()).toEqual(["Bed A", "Bed B"]);
  });

  it("sorts a grouped row's own plantings by planted_date ascending", () => {
    const plantings = [
      makePlanting({ id: 1, bed_id: 1, plant_slug: "squash", planted_date: "2026-06-01" }),
      makePlanting({ id: 2, bed_id: 1, plant_slug: "squash", planted_date: "2026-04-01" }),
      makePlanting({ id: 3, bed_id: 1, plant_slug: "squash", planted_date: "2026-05-01" }),
    ];
    const rows = timelineRows(plantings, 2026, plantsBySlug, bedsById);
    expect(rows[0].plantings.map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it("a single planting in a bed still produces exactly one row (no regression)", () => {
    const plantings = [makePlanting({ id: 1, bed_id: 1, plant_slug: "tomato" })];
    const rows = timelineRows(plantings, 2026, plantsBySlug, bedsById);
    expect(rows).toHaveLength(1);
    expect(rows[0].plantings).toHaveLength(1);
  });

  it("row order is unaffected by grouping - plant common name then bed name", () => {
    const plantings = [
      makePlanting({ id: 1, bed_id: 2, plant_slug: "tomato" }),
      makePlanting({ id: 2, bed_id: 1, plant_slug: "squash" }),
    ];
    const rows = timelineRows(plantings, 2026, plantsBySlug, bedsById);
    expect(rows.map((r) => r.plant.common_name)).toEqual(["Acorn squash", "Tomato"]);
  });
});

describe("bedIdsWithBedOnlyActions", () => {
  it("collects only bed ids with a bed-only (no plant_slug) action", () => {
    const actions = [
      makeAction({ bed_id: 1, plant_slug: null }),
      makeAction({ bed_id: 2, plant_slug: "tomato" }),
      makeAction({ bed_id: 3, plant_slug: null }),
    ];
    expect(bedIdsWithBedOnlyActions(actions)).toEqual(new Set([1, 3]));
  });
});
