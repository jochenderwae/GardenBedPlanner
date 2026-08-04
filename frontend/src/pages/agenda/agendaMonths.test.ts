import { describe, expect, it } from "vitest";
import { monthsInPeriod } from "./agendaMonths";

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
