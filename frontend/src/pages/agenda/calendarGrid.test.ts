import { describe, expect, it } from "vitest";
import { addDays, addMonths, addWeeks, isToday, isoYearMonth, monthGridDays, weekDays } from "./calendarGrid";

describe("isoYearMonth", () => {
  it("splits an ISO date into year/month (1-12)", () => {
    expect(isoYearMonth("2026-08-04")).toEqual({ year: 2026, month: 8 });
  });
});

describe("monthGridDays", () => {
  it("always returns 42 cells", () => {
    expect(monthGridDays(2026, 8)).toHaveLength(42);
  });

  it("starts on the Monday on/before the 1st and is tagged inCurrentMonth correctly", () => {
    // August 2026: the 1st is a Saturday, so the grid starts Monday 2026-07-27.
    const days = monthGridDays(2026, 8);
    expect(days[0]).toEqual({ iso: "2026-07-27", inCurrentMonth: false });
    const first = days.find((d) => d.iso === "2026-08-01");
    expect(first?.inCurrentMonth).toBe(true);
    const last = days.find((d) => d.iso === "2026-08-31");
    expect(last?.inCurrentMonth).toBe(true);
  });

  it("is stable across a February with fewer weeks", () => {
    expect(monthGridDays(2026, 2)).toHaveLength(42);
  });
});

describe("weekDays", () => {
  it("returns Monday..Sunday for the week containing the given date", () => {
    // 2026-08-04 is a Tuesday.
    expect(weekDays("2026-08-04")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("handles a Sunday correctly (last day of the Monday-start week)", () => {
    expect(weekDays("2026-08-09")[0]).toBe("2026-08-03");
  });
});

describe("isToday", () => {
  it("compares two ISO strings directly", () => {
    expect(isToday("2026-08-04", "2026-08-04")).toBe(true);
    expect(isToday("2026-08-04", "2026-08-05")).toBe(false);
  });
});

describe("addDays / addWeeks", () => {
  it("steps by whole days, crossing month boundaries", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-08-04", -5)).toBe("2026-07-30");
  });

  it("steps by whole weeks", () => {
    expect(addWeeks("2026-08-04", 1)).toBe("2026-08-11");
    expect(addWeeks("2026-08-04", -1)).toBe("2026-07-28");
  });
});

describe("addMonths", () => {
  it("steps by whole months, crossing year boundaries", () => {
    expect(addMonths("2026-08-04", 5)).toBe("2027-01-04");
    expect(addMonths("2026-08-04", -9)).toBe("2025-11-04");
  });

  it("clamps day-of-month into a shorter target month instead of overflowing", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});
