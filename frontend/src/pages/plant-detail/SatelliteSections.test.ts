import { describe, expect, it } from "vitest";
import { monthName, monthRangeLabel } from "./SatelliteSections";

describe("monthName", () => {
  it("maps 1-12 month numbers to their name", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
  });

  it("falls back to the raw number string for an out-of-range value rather than throwing/undefined", () => {
    expect(monthName(0)).toBe("0");
    expect(monthName(13)).toBe("13");
  });
});

describe("monthRangeLabel", () => {
  it("renders a real range as 'Start–End'", () => {
    expect(monthRangeLabel(3, 5)).toBe("March–May");
  });

  it("renders a single-month period as just that month, not 'March–March'", () => {
    expect(monthRangeLabel(6, 6)).toBe("June");
  });

  it("renders a year-wrapping range (e.g. an overwintering sow window) as-is, not reordered", () => {
    expect(monthRangeLabel(11, 2)).toBe("November–February");
  });
});
