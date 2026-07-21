import { describe, expect, it } from "vitest";
import type { Plant, PlantPeriod, SeedInventoryItem } from "@/api/client";
import { buildSeedGuideEntries, isSowingApproaching } from "./seedGuide";

function makePlant(overrides: Partial<Plant>): Plant {
  return {
    slug: "tomato",
    common_name: "Tomato",
    botanical_name: "Solanum lycopersicum",
    ...overrides,
  } as Plant;
}

function makeItem(overrides: Partial<SeedInventoryItem>): SeedInventoryItem {
  return { plant_slug: "tomato", notes: "", ...overrides } as SeedInventoryItem;
}

function makePeriod(overrides: Partial<PlantPeriod>): PlantPeriod {
  return { id: 1, plant_slug: "tomato", period_type: "sowing", start_month: 2, end_month: 3, ...overrides };
}

describe("isSowingApproaching", () => {
  it("is true when the reference month falls inside a sowing period", () => {
    expect(isSowingApproaching([makePeriod({ start_month: 2, end_month: 4 })], 3)).toBe(true);
  });

  it("is true when the very next month starts a sowing period", () => {
    expect(isSowingApproaching([makePeriod({ start_month: 3, end_month: 4 })], 2)).toBe(true);
  });

  it("is false when no sowing period is close", () => {
    expect(isSowingApproaching([makePeriod({ start_month: 6, end_month: 7 })], 1)).toBe(false);
  });

  it("ignores periods that aren't sowing periods", () => {
    expect(isSowingApproaching([makePeriod({ period_type: "harvesting", start_month: 3, end_month: 3 })], 3)).toBe(
      false,
    );
  });

  it("wraps across the year boundary", () => {
    expect(isSowingApproaching([makePeriod({ start_month: 11, end_month: 1 })], 12)).toBe(true);
  });
});

describe("buildSeedGuideEntries", () => {
  const plantsBySlug = new Map([["tomato", makePlant({ slug: "tomato", common_name: "Tomato" })]]);
  const periodsBySlug = new Map([["tomato", [makePeriod({ start_month: 3, end_month: 4 })]]]);

  it("flags 'buy' when the sowing window is approaching and there's no stock", () => {
    const items = [makeItem({ quantity_seeds: 0, weight_grams: null })];
    const entries = buildSeedGuideEntries(items, plantsBySlug, periodsBySlug, 3);
    expect(entries).toEqual([{ plantSlug: "tomato", plantCommonName: "Tomato", hasStock: false, urgency: "buy" }]);
  });

  it("flags 'sow' when the sowing window is approaching and stock is on hand", () => {
    const items = [makeItem({ quantity_seeds: 20 })];
    const entries = buildSeedGuideEntries(items, plantsBySlug, periodsBySlug, 3);
    expect(entries[0]).toMatchObject({ hasStock: true, urgency: "sow" });
  });

  it("treats a recorded weight as stock, same as a seed count", () => {
    const items = [makeItem({ quantity_seeds: null, weight_grams: 5 })];
    const entries = buildSeedGuideEntries(items, plantsBySlug, periodsBySlug, 3);
    expect(entries[0]).toMatchObject({ hasStock: true, urgency: "sow" });
  });

  it("flags 'ok' when no sowing window is approaching, regardless of stock", () => {
    const items = [makeItem({ quantity_seeds: 0 })];
    const entries = buildSeedGuideEntries(items, plantsBySlug, periodsBySlug, 9);
    expect(entries[0]).toMatchObject({ urgency: "ok" });
  });

  it("skips an item whose plant isn't in the lookup map", () => {
    const items = [makeItem({ plant_slug: "unknown-plant" })];
    expect(buildSeedGuideEntries(items, plantsBySlug, periodsBySlug, 3)).toEqual([]);
  });

  it("treats a plant with no recorded periods as never approaching", () => {
    const items = [makeItem({ plant_slug: "tomato" })];
    const entries = buildSeedGuideEntries(items, plantsBySlug, new Map(), 3);
    expect(entries[0]).toMatchObject({ urgency: "ok" });
  });
});
