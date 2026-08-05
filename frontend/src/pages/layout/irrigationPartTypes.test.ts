import { describe, expect, it } from "vitest";
import type { IrrigationPartType } from "@/api/client";
import { findIrrigationPartType } from "./irrigationPartTypes";

function type(slug: string, name: string, connectionCount: number): IrrigationPartType {
  return {
    id: 1,
    resource_pack_id: 1,
    slug,
    name,
    connection_count: connectionCount,
    part_number: null,
    icon_key: null,
  };
}

const types: IrrigationPartType[] = [
  type("nozzle", "Nozzle", 1),
  type("t_junction", "T-Junction", 3),
  type("end_cap", "End Cap", 1),
];

describe("findIrrigationPartType", () => {
  it("matches an exact slug", () => {
    expect(findIrrigationPartType("nozzle", types)?.slug).toBe("nozzle");
  });

  it("matches case-insensitively", () => {
    expect(findIrrigationPartType("Nozzle", types)?.slug).toBe("nozzle");
  });

  it("matches a space-separated human name against an underscore slug", () => {
    expect(findIrrigationPartType("t junction", types)?.slug).toBe("t_junction");
    expect(findIrrigationPartType("End Cap", types)?.slug).toBe("end_cap");
  });

  it("tolerates surrounding whitespace", () => {
    expect(findIrrigationPartType("  nozzle  ", types)?.slug).toBe("nozzle");
  });

  it("returns undefined for an exotic/one-off type with no match", () => {
    expect(findIrrigationPartType("misting fan", types)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(findIrrigationPartType("", types)).toBeUndefined();
  });
});
