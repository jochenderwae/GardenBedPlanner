import { describe, expect, it } from "vitest";
import type { Planting } from "@/api/client";
import {
  addDaysToIsoDate,
  daysBetweenIsoDates,
  defaultScrubberRange,
  describeRemovalSchedule,
  isPlantingActiveAsOf,
  removalVisualState,
} from "./plantingLifecycle";

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

describe("daysBetweenIsoDates", () => {
  it("counts forward days", () => {
    expect(daysBetweenIsoDates("2026-07-01", "2026-07-11")).toBe(10);
  });

  it("counts backward (negative) days", () => {
    expect(daysBetweenIsoDates("2026-07-11", "2026-07-01")).toBe(-10);
  });

  it("is zero for the same date", () => {
    expect(daysBetweenIsoDates("2026-07-01", "2026-07-01")).toBe(0);
  });

  it("crosses a month boundary correctly", () => {
    expect(daysBetweenIsoDates("2026-07-25", "2026-08-05")).toBe(11);
  });
});

describe("addDaysToIsoDate", () => {
  it("adds days forward", () => {
    expect(addDaysToIsoDate("2026-07-01", 10)).toBe("2026-07-11");
  });

  it("subtracts days for a negative offset", () => {
    expect(addDaysToIsoDate("2026-07-11", -10)).toBe("2026-07-01");
  });

  it("rolls over a year boundary", () => {
    expect(addDaysToIsoDate("2026-12-28", 5)).toBe("2027-01-02");
  });
});

describe("isPlantingActiveAsOf", () => {
  it("is active with no planted/removed date at all", () => {
    expect(isPlantingActiveAsOf(makePlanting({}), "2026-07-28")).toBe(true);
  });

  it("is active when removed_date is in the future", () => {
    const planting = makePlanting({ removed_date: "2026-08-15" });
    expect(isPlantingActiveAsOf(planting, "2026-07-28")).toBe(true);
  });

  it("is not active once removed_date has passed", () => {
    const planting = makePlanting({ removed_date: "2026-07-01" });
    expect(isPlantingActiveAsOf(planting, "2026-07-28")).toBe(false);
  });

  it("is not active on the exact removed_date (removed that day)", () => {
    const planting = makePlanting({ removed_date: "2026-07-28" });
    expect(isPlantingActiveAsOf(planting, "2026-07-28")).toBe(false);
  });

  it("is not active before its own planted_date", () => {
    const planting = makePlanting({ planted_date: "2026-09-01" });
    expect(isPlantingActiveAsOf(planting, "2026-07-28")).toBe(false);
  });

  it("is active on and after its own planted_date", () => {
    const planting = makePlanting({ planted_date: "2026-07-01" });
    expect(isPlantingActiveAsOf(planting, "2026-07-28")).toBe(true);
  });
});

describe("removalVisualState", () => {
  it("is normal with no removed_date", () => {
    expect(removalVisualState(makePlanting({}), "2026-07-28")).toBe("normal");
  });

  it("is scheduled when removal is well in the future", () => {
    const planting = makePlanting({ removed_date: "2026-09-01" });
    expect(removalVisualState(planting, "2026-07-28")).toBe("scheduled");
  });

  it("is leaving-soon within the threshold", () => {
    const planting = makePlanting({ removed_date: "2026-08-01" });
    expect(removalVisualState(planting, "2026-07-28")).toBe("leaving-soon");
  });
});

describe("describeRemovalSchedule", () => {
  it("is null with no removed_date", () => {
    expect(describeRemovalSchedule(makePlanting({}), "2026-07-28")).toBeNull();
  });

  it("describes a multi-day future window", () => {
    const planting = makePlanting({ removed_date: "2026-08-09" });
    expect(describeRemovalSchedule(planting, "2026-07-28")).toBe("Scheduled to be cleared in 12 days");
  });

  it("describes tomorrow", () => {
    const planting = makePlanting({ removed_date: "2026-07-29" });
    expect(describeRemovalSchedule(planting, "2026-07-28")).toBe("Scheduled to be cleared tomorrow");
  });

  it("describes today", () => {
    const planting = makePlanting({ removed_date: "2026-07-28" });
    expect(describeRemovalSchedule(planting, "2026-07-28")).toBe("Scheduled to be cleared today");
  });

  it("describes a past removal", () => {
    const planting = makePlanting({ removed_date: "2026-07-20" });
    expect(describeRemovalSchedule(planting, "2026-07-28")).toBe("Cleared 8 days ago");
  });
});

describe("defaultScrubberRange", () => {
  it("always includes today even with no plantings", () => {
    const { min, max } = defaultScrubberRange([], "2026-07-28");
    expect(min <= "2026-07-28").toBe(true);
    expect(max >= "2026-07-28").toBe(true);
  });

  it("spans past a planting's own recorded dates", () => {
    const plantings = [makePlanting({ planted_date: "2024-03-01", removed_date: "2024-09-01" })];
    const { min, max } = defaultScrubberRange(plantings, "2026-07-28");
    expect(min < "2024-03-01").toBe(true);
    expect(max >= "2026-07-28").toBe(true);
  });
});
