import { describe, expect, it } from "vitest";
import { monthName, monthRangeLabel } from "./SatelliteSections";

describe("monthName", () => {
  it("maps 1-12 month numbers to their name", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
  });
});

describe("monthRangeLabel", () => {
  it("renders a real range as 'Start–End'", () => {
    expect(monthRangeLabel(3, 5)).toBe("March–May");
  });

  it("renders a single-month period as just that month, not 'March–March'", () => {
    expect(monthRangeLabel(6, 6)).toBe("June");
  });
});
