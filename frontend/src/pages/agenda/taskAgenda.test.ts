import { describe, expect, it } from "vitest";
import type { Action } from "@/api/client";
import { groupActionsByDueDate, isSnoozed, sortByUrgency, sortedDueDates, taskDueDateKey } from "./taskAgenda";

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

describe("sortByUrgency", () => {
  it("sorts by due_date_end ascending (closest deadline first)", () => {
    const a = makeAction({ id: 1, due_date_end: "2026-09-01" });
    const b = makeAction({ id: 2, due_date_end: "2026-07-01" });
    const c = makeAction({ id: 3, due_date_end: "2026-08-01" });
    expect(sortByUrgency([a, b, c]).map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it("sorts an action with no due_date_end last, not first", () => {
    const scheduled = makeAction({ id: 1, due_date_end: "2026-07-01" });
    const unscheduled = makeAction({ id: 2, due_date_end: null });
    expect(sortByUrgency([unscheduled, scheduled]).map((x) => x.id)).toEqual([1, 2]);
  });

  it("breaks ties on the same due_date_end by action_type alphabetically", () => {
    const sow = makeAction({ id: 1, action_type: "sow", due_date_end: "2026-07-31" });
    const harvest = makeAction({ id: 2, action_type: "harvest", due_date_end: "2026-07-31" });
    expect(sortByUrgency([sow, harvest]).map((x) => x.id)).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const a = makeAction({ id: 1, due_date_end: "2026-09-01" });
    const b = makeAction({ id: 2, due_date_end: "2026-07-01" });
    const original = [a, b];
    sortByUrgency(original);
    expect(original).toEqual([a, b]);
  });

  it("returns an empty array for no actions", () => {
    expect(sortByUrgency([])).toEqual([]);
  });
});

describe("isSnoozed", () => {
  it("is false when snoozed_until is null", () => {
    expect(isSnoozed(makeAction({ snoozed_until: null }), "2026-08-01")).toBe(false);
  });

  it("is true when snoozed_until is today", () => {
    expect(isSnoozed(makeAction({ snoozed_until: "2026-08-01" }), "2026-08-01")).toBe(true);
  });

  it("is true when snoozed_until is in the future", () => {
    expect(isSnoozed(makeAction({ snoozed_until: "2026-08-15" }), "2026-08-01")).toBe(true);
  });

  it("is false once snoozed_until is in the past - auto-clears with no manual step", () => {
    expect(isSnoozed(makeAction({ snoozed_until: "2026-07-31" }), "2026-08-01")).toBe(false);
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
