import { describe, expect, it } from "vitest";
import type { EquipmentType } from "@/api/client";
import { findEquipmentType } from "./equipmentTypes";

function type(slug: string, name: string): EquipmentType {
  return {
    id: 1,
    slug,
    name,
    category: "bed_bound",
    default_height_cm: 100,
    default_geometry: { type: "rectangle", x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  };
}

const types: EquipmentType[] = [type("trellis", "Trellis"), type("drip_line", "Drip Line"), type("cold_frame", "Cold Frame")];

describe("findEquipmentType", () => {
  it("matches an exact slug", () => {
    expect(findEquipmentType("trellis", types)?.slug).toBe("trellis");
  });

  it("matches case-insensitively", () => {
    expect(findEquipmentType("Trellis", types)?.slug).toBe("trellis");
  });

  it("matches a space-separated human name against an underscore slug", () => {
    expect(findEquipmentType("drip line", types)?.slug).toBe("drip_line");
    expect(findEquipmentType("Cold Frame", types)?.slug).toBe("cold_frame");
  });

  it("tolerates surrounding whitespace", () => {
    expect(findEquipmentType("  trellis  ", types)?.slug).toBe("trellis");
  });

  it("returns undefined for an exotic/one-off type with no match", () => {
    expect(findEquipmentType("bird netting", types)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(findEquipmentType("", types)).toBeUndefined();
  });
});
