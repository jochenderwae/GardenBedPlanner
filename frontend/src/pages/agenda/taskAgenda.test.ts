import { describe, expect, it } from "vitest";
import type { Action } from "@/api/client";
import { groupActionsByDueDate, sortedDueDates, taskDueDateKey } from "./taskAgenda";

function makeAction(overrides: Partial<Action>): Action {
  return {
    id: 1,
    action_type: "sow",
    due_date_start: null,
    due_date_end: null,
    completed_date: null,
    status: "pending",
    garden_plan_entry_id: null,
    bed_id: null,
    plant_slug: null,
    equipment_id: null,
    depends_on_action_id: null,
    notes: "",
    ...overrides,
  } as Action;
}

describe("taskDueDateKey", () => {
  it("is the due window's own end date", () => {
    const action = makeAction({ due_date_start: "2026-07-01", due_date_end: "2026-07-31" });
    expect(taskDueDateKey(action)).toBe("2026-07-31");
  });

  it("is null with no due_date_end at all", () => {
    expect(taskDueDateKey(makeAction({ due_date_end: null }))).toBeNull();
  });
});

describe("groupActionsByDueDate", () => {
  it("groups actions under their own due_date_end", () => {
    const a = makeAction({ id: 1, action_type: "sow", due_date_end: "2026-07-31" });
    const b = makeAction({ id: 2, action_type: "harvest", due_date_end: "2026-07-31" });
    const c = makeAction({ id: 3, action_type: "plant", due_date_end: "2026-08-15" });
    const byDate = groupActionsByDueDate([a, b, c]);
    expect(byDate.get("2026-07-31")?.map((x) => x.id)).toEqual([2, 1]); // sorted by action_type: harvest < sow
    expect(byDate.get("2026-08-15")?.map((x) => x.id)).toEqual([3]);
  });

  it("drops actions with no due_date_end", () => {
    const scheduled = makeAction({ id: 1, due_date_end: "2026-07-31" });
    const unscheduled = makeAction({ id: 2, due_date_end: null });
    const byDate = groupActionsByDueDate([scheduled, unscheduled]);
    expect([...byDate.values()].flat().map((a) => a.id)).toEqual([1]);
  });
});

describe("sortedDueDates", () => {
  it("returns dates in chronological order regardless of insertion order", () => {
    const byDate = groupActionsByDueDate([
      makeAction({ id: 1, due_date_end: "2026-09-01" }),
      makeAction({ id: 2, due_date_end: "2026-07-01" }),
      makeAction({ id: 3, due_date_end: "2026-08-01" }),
    ]);
    expect(sortedDueDates(byDate)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });
});
