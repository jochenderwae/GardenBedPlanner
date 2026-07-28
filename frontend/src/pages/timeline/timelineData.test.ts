import { describe, expect, it } from "vitest";
import type { Action, Planting } from "@/api/client";
import {
  actionDueDate,
  actionsForBedOnly,
  actionsForPlanting,
  bedIdsWithBedOnlyActions,
  dayFractionInMonth,
  periodBarSegments,
  plantingOverlapsYear,
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

describe("actionsForPlanting / actionsForBedOnly", () => {
  const planting = makePlanting({ bed_id: 7, plant_slug: "tomato" });
  const actions = [
    makeAction({ id: 1, bed_id: 7, plant_slug: "tomato" }),
    makeAction({ id: 2, bed_id: 7, plant_slug: "basil" }),
    makeAction({ id: 3, bed_id: 7, plant_slug: null, action_type: "prepare_bed" }),
    makeAction({ id: 4, bed_id: 9, plant_slug: "tomato" }),
  ];

  it("matches on bed_id AND plant_slug", () => {
    expect(actionsForPlanting(actions, planting).map((a) => a.id)).toEqual([1]);
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
