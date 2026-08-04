import { describe, expect, it } from "vitest";
import type { HarvestLog, Planting } from "@/api/client";
import { buildYieldHistory, plantSlugForLog } from "./yieldHistory";

function makePlanting(id: number, plantSlug: string): Planting {
  return {
    id,
    bed_id: 1,
    plant_slug: plantSlug,
    placement_type: "individual",
    geometry: { type: "rectangle", x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    planted_date: null,
    removed_date: null,
    spacing_cm: null,
  } as Planting;
}

function makeLog(overrides: Partial<HarvestLog>): HarvestLog {
  return {
    id: 1,
    planting_id: 1,
    harvest_date: "2026-07-01",
    yield_amount: null,
    yield_unit: null,
    quality: null,
    notes: "",
    ...overrides,
  } as HarvestLog;
}

describe("plantSlugForLog", () => {
  it("resolves the log's plant via its planting", () => {
    const plantingsById = new Map([[1, makePlanting(1, "tomato")]]);
    expect(plantSlugForLog(makeLog({ planting_id: 1 }), plantingsById)).toBe("tomato");
  });

  it("returns null when the planting can't be found", () => {
    expect(plantSlugForLog(makeLog({ planting_id: 99 }), new Map())).toBeNull();
  });
});

describe("buildYieldHistory", () => {
  const plantingsById = new Map([
    [1, makePlanting(1, "tomato")],
    [2, makePlanting(2, "onion")],
  ]);

  it("groups logs by plant, then by year, most-recent-year-first", () => {
    const logs = [
      makeLog({ id: 1, planting_id: 1, harvest_date: "2025-08-01", yield_amount: 2, yield_unit: "kg" }),
      makeLog({ id: 2, planting_id: 1, harvest_date: "2026-07-15", yield_amount: 3, yield_unit: "kg" }),
      makeLog({ id: 3, planting_id: 2, harvest_date: "2026-09-01", yield_amount: 10, yield_unit: "count" }),
    ];
    const groups = buildYieldHistory(logs, plantingsById);
    expect(groups.map((g) => g.plantSlug)).toEqual(["onion", "tomato"]);

    const tomato = groups.find((g) => g.plantSlug === "tomato")!;
    expect(tomato.years.map((y) => y.year)).toEqual([2026, 2025]);
  });

  it("sums per-unit totals within a year, keeping distinct units separate", () => {
    const logs = [
      makeLog({ id: 1, planting_id: 1, harvest_date: "2026-07-01", yield_amount: 2, yield_unit: "kg" }),
      makeLog({ id: 2, planting_id: 1, harvest_date: "2026-07-10", yield_amount: 1.5, yield_unit: "kg" }),
      makeLog({ id: 3, planting_id: 1, harvest_date: "2026-07-20", yield_amount: 5, yield_unit: "count" }),
    ];
    const [tomato] = buildYieldHistory(logs, plantingsById);
    const [year2026] = tomato.years;
    expect(year2026.unitTotals).toEqual(
      expect.arrayContaining([
        { unit: "kg", total: 3.5 },
        { unit: "count", total: 5 },
      ]),
    );
    expect(year2026.entries).toHaveLength(3);
    // most-recent entry first
    expect(year2026.entries[0].id).toBe(3);
  });

  it("still produces a sensible single-year group without any amount at all", () => {
    const logs = [makeLog({ id: 1, planting_id: 2, harvest_date: "2026-07-01", quality: "good", notes: "nice" })];
    const [onion] = buildYieldHistory(logs, plantingsById);
    expect(onion.years).toHaveLength(1);
    expect(onion.years[0].unitTotals).toEqual([]);
    expect(onion.years[0].entries[0].notes).toBe("nice");
  });

  it("skips logs whose planting can't be resolved", () => {
    const logs = [makeLog({ id: 1, planting_id: 999, harvest_date: "2026-07-01" })];
    expect(buildYieldHistory(logs, plantingsById)).toEqual([]);
  });
});
