import { describe, expect, it } from "vitest";
import type { Bed, Plant, Planting, PlantPeriod } from "@/api/client";
import { applyPeriodTypeLabels, buildAgendaEntries, groupByMonth, monthsInPeriod } from "./agendaMonths";

describe("monthsInPeriod", () => {
  it("covers a plain in-year range", () => {
    expect(monthsInPeriod(3, 5)).toEqual([3, 4, 5]);
  });

  it("covers a single month", () => {
    expect(monthsInPeriod(6, 6)).toEqual([6]);
  });

  it("wraps across the year boundary", () => {
    expect(monthsInPeriod(11, 2)).toEqual([11, 12, 1, 2]);
  });
});

function makePlant(overrides: Partial<Plant>): Plant {
  return {
    slug: "tomato",
    common_name: "Tomato",
    botanical_name: "Solanum lycopersicum",
    ...overrides,
  } as Plant;
}

function makePlanting(overrides: Partial<Planting>): Planting {
  return {
    id: 1,
    bed_id: 1,
    plant_slug: "tomato",
    placement_type: "individual",
    planted_date: null,
    removed_date: null,
    geometry: { type: "rectangle", x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    ...overrides,
  } as Planting;
}

function makeBed(overrides: Partial<Bed>): Bed {
  return { id: 1, name: "Bed A", height_cm: 0, has_greenhouse: false, ...overrides } as Bed;
}

describe("buildAgendaEntries", () => {
  const tomato = makePlant({ slug: "tomato", common_name: "Tomato" });
  const bedsById = new Map([[1, makeBed({ id: 1, name: "Bed A" })]]);
  const plantsBySlug = new Map([["tomato", tomato]]);
  const periods: PlantPeriod[] = [
    { id: 1, plant_slug: "tomato", period_type: "sow_indoor", start_month: 2, end_month: 3 },
  ];

  it("emits one entry per month a period covers, for an active planting", () => {
    const plantings = [makePlanting({ id: 1, plant_slug: "tomato", bed_id: 1 })];
    const entries = buildAgendaEntries(plantings, plantsBySlug, periods, bedsById);
    expect(entries.map((e) => e.month)).toEqual([2, 3]);
    expect(entries[0]).toMatchObject({ plantCommonName: "Tomato", bedName: "Bed A", periodTypeCode: "sow_indoor" });
  });

  it("excludes plantings that have already been removed", () => {
    const plantings = [makePlanting({ id: 1, plant_slug: "tomato", bed_id: 1, removed_date: "2026-06-01" })];
    expect(buildAgendaEntries(plantings, plantsBySlug, periods, bedsById)).toEqual([]);
  });

  it("skips a planting whose plant or bed isn't in the lookup maps", () => {
    const plantings = [makePlanting({ id: 1, plant_slug: "unknown-plant", bed_id: 1 })];
    expect(buildAgendaEntries(plantings, plantsBySlug, periods, bedsById)).toEqual([]);
  });

  it("gives each bed its own entries for the same plant placed in multiple beds", () => {
    const bedsById2 = new Map([
      [1, makeBed({ id: 1, name: "Bed A" })],
      [2, makeBed({ id: 2, name: "Bed B" })],
    ]);
    const plantings = [
      makePlanting({ id: 1, plant_slug: "tomato", bed_id: 1 }),
      makePlanting({ id: 2, plant_slug: "tomato", bed_id: 2 }),
    ];
    const entries = buildAgendaEntries(plantings, plantsBySlug, periods, bedsById2);
    expect(entries.map((e) => e.bedName).sort()).toEqual(["Bed A", "Bed A", "Bed B", "Bed B"]);
  });
});

describe("applyPeriodTypeLabels", () => {
  it("substitutes the human label when one exists", () => {
    const entries = buildAgendaEntries(
      [makePlanting({ id: 1, plant_slug: "tomato", bed_id: 1 })],
      new Map([["tomato", makePlant({ slug: "tomato" })]]),
      [{ id: 1, plant_slug: "tomato", period_type: "sow_indoor", start_month: 2, end_month: 2 }],
      new Map([[1, makeBed({ id: 1, name: "Bed A" })]]),
    );
    const labeled = applyPeriodTypeLabels(entries, new Map([["sow_indoor", "Sow indoors"]]));
    expect(labeled[0].periodTypeLabel).toBe("Sow indoors");
  });

  it("falls back to the raw code when there's no label", () => {
    const entries = buildAgendaEntries(
      [makePlanting({ id: 1, plant_slug: "tomato", bed_id: 1 })],
      new Map([["tomato", makePlant({ slug: "tomato" })]]),
      [{ id: 1, plant_slug: "tomato", period_type: "sow_indoor", start_month: 2, end_month: 2 }],
      new Map([[1, makeBed({ id: 1, name: "Bed A" })]]),
    );
    const labeled = applyPeriodTypeLabels(entries, new Map());
    expect(labeled[0].periodTypeLabel).toBe("sow_indoor");
  });
});

describe("groupByMonth", () => {
  it("returns all 12 months, each sorted by plant name", () => {
    const entries = [
      { month: 3, plantSlug: "b", plantCommonName: "Beet", periodTypeCode: "sow", periodTypeLabel: "Sow", bedId: 1, bedName: "Bed A" },
      { month: 3, plantSlug: "a", plantCommonName: "Apple", periodTypeCode: "sow", periodTypeLabel: "Sow", bedId: 1, bedName: "Bed A" },
    ];
    const grouped = groupByMonth(entries);
    expect(grouped.size).toBe(12);
    expect(grouped.get(3)?.map((e) => e.plantCommonName)).toEqual(["Apple", "Beet"]);
    expect(grouped.get(1)).toEqual([]);
  });
});
