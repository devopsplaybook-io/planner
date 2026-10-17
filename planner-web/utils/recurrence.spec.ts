import { describe, expect, it } from "vitest";
import type { TaskRecurrence } from "../stores/tasks";
import {
  applyRecurringFilter,
  computeNextDueDate,
  findPreviousOccurrence,
  recurrenceLabel,
} from "./recurrence";

describe("recurrenceLabel", () => {
  it("labels daily rules", () => {
    expect(recurrenceLabel({ frequency: "daily", interval: 1 })).toBe(
      "Every day",
    );
    expect(recurrenceLabel({ frequency: "daily", interval: 3 })).toBe(
      "Every 3 days",
    );
  });

  it("labels weekly rules without weekdays", () => {
    expect(recurrenceLabel({ frequency: "weekly", interval: 1 })).toBe(
      "Every week",
    );
    expect(recurrenceLabel({ frequency: "weekly", interval: 2 })).toBe(
      "Every 2 weeks",
    );
  });

  it("labels weekly rules with a weekday set, sorted and weekday-only", () => {
    expect(
      recurrenceLabel({ frequency: "weekly", interval: 1, weekdays: [1, 5] }),
    ).toBe("Every week on Mon, Fri");
    expect(
      recurrenceLabel({ frequency: "weekly", interval: 3, weekdays: [5, 1] }),
    ).toBe("Every week on Mon, Fri");
    expect(
      recurrenceLabel({ frequency: "weekly", interval: 1, weekdays: [0] }),
    ).toBe("Every week on Sun");
  });

  it("labels monthly rules", () => {
    expect(recurrenceLabel({ frequency: "monthly", interval: 1 })).toBe(
      "Every month",
    );
    expect(recurrenceLabel({ frequency: "monthly", interval: 3 })).toBe(
      "Every 3 months",
    );
  });

  it("returns an empty string for a missing rule", () => {
    expect(recurrenceLabel(null)).toBe("");
    expect(recurrenceLabel(undefined)).toBe("");
  });
});

// Vectors mirrored from planner-server/src/tasks/TaskRecurrence.spec.ts —
// the client preview must match the server's spawn computation exactly.
describe("computeNextDueDate", () => {
  it("shifts daily rules by interval days", () => {
    expect(
      computeNextDueDate({ frequency: "daily", interval: 1 }, "2026-10-16"),
    ).toBe("2026-10-17");
    expect(
      computeNextDueDate({ frequency: "daily", interval: 3 }, "2026-10-30"),
    ).toBe("2026-11-02");
  });

  it("shifts weekly rules without weekdays by interval weeks", () => {
    expect(
      computeNextDueDate({ frequency: "weekly", interval: 1 }, "2026-10-16"),
    ).toBe("2026-10-23");
    expect(
      computeNextDueDate({ frequency: "weekly", interval: 2 }, "2026-10-16"),
    ).toBe("2026-10-30");
  });

  it("picks the next day in the weekday set, strictly after the due date", () => {
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [1] };
    // 2026-10-14 is a Wednesday; the next Monday is the 19th
    expect(computeNextDueDate(rule, "2026-10-14")).toBe("2026-10-19");
    // 2026-10-19 is a Monday; the next Monday in the set is the 26th
    expect(computeNextDueDate(rule, "2026-10-19")).toBe("2026-10-26");
  });

  it("wraps to the next week across month and year boundaries", () => {
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [1] };
    // 2026-10-31 is a Saturday; the next Monday is Nov 2
    expect(computeNextDueDate(rule, "2026-10-31")).toBe("2026-11-02");
    // 2026-12-28 is a Monday; the next Monday is Jan 4, 2027
    expect(computeNextDueDate(rule, "2026-12-28")).toBe("2027-01-04");
  });

  it("shifts monthly rules by interval months", () => {
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 1 }, "2026-10-16"),
    ).toBe("2026-11-16");
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 3 }, "2026-10-16"),
    ).toBe("2027-01-16");
  });

  it("clamps monthly rules to the target month's last day", () => {
    // Jan 31 -> Feb 28 (2026 is not a leap year)
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 1 }, "2026-01-31"),
    ).toBe("2026-02-28");
    // Jan 31 -> Feb 29 (2028 is a leap year)
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 1 }, "2028-01-31"),
    ).toBe("2028-02-29");
    // Mar 31 -> Apr 30
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 1 }, "2026-03-31"),
    ).toBe("2026-04-30");
  });

  it("returns null for a missing rule or a missing/malformed due date", () => {
    expect(computeNextDueDate(null, "2026-10-16")).toBeNull();
    expect(computeNextDueDate(undefined, "2026-10-16")).toBeNull();
    expect(computeNextDueDate({ frequency: "daily", interval: 1 })).toBeNull();
    expect(
      computeNextDueDate({ frequency: "daily", interval: 1 }, ""),
    ).toBeNull();
    expect(
      computeNextDueDate({ frequency: "daily", interval: 1 }, "garbage"),
    ).toBeNull();
    expect(
      computeNextDueDate({ frequency: "daily", interval: 1 }, "2026-13-40"),
    ).toBeNull();
  });
});

describe("findPreviousOccurrence", () => {
  const recurrence = { frequency: "weekly" as const, interval: 1 };

  it("returns the same-title dependency of a recurring task", () => {
    const dep = { taskId: "task-1", title: "Water the plants" };
    expect(
      findPreviousOccurrence({
        recurrence,
        title: "Water the plants",
        dependencies: [{ taskId: "other", title: "Something else" }, dep],
      }),
    ).toEqual(dep);
  });

  it("matches with the [cancelled] suffix on either side", () => {
    expect(
      findPreviousOccurrence({
        recurrence,
        title: "Water the plants [cancelled]",
        dependencies: [{ taskId: "task-1", title: "Water the plants" }],
      })?.taskId,
    ).toBe("task-1");
    expect(
      findPreviousOccurrence({
        recurrence,
        title: "Water the plants",
        dependencies: [{ taskId: "task-1", title: "Water the plants [cancelled]" }],
      })?.taskId,
    ).toBe("task-1");
  });

  it("returns null for a non-recurring task", () => {
    expect(
      findPreviousOccurrence({
        recurrence: null,
        title: "Water the plants",
        dependencies: [{ taskId: "task-1", title: "Water the plants" }],
      }),
    ).toBeNull();
  });

  it("returns null without dependencies or without a match", () => {
    expect(findPreviousOccurrence({ recurrence, title: "A" })).toBeNull();
    expect(
      findPreviousOccurrence({ recurrence, title: "A", dependencies: [] }),
    ).toBeNull();
    expect(
      findPreviousOccurrence({
        recurrence,
        title: "A",
        dependencies: [{ taskId: "task-1", title: "B" }],
      }),
    ).toBeNull();
  });
});

describe("applyRecurringFilter", () => {
  const recurring = { id: "r", recurrence: { frequency: "daily" as const, interval: 1 } };
  const plain = { id: "p", recurrence: null };

  it("passes all tasks through in the all mode", () => {
    expect(applyRecurringFilter([recurring, plain], "all")).toEqual([
      recurring,
      plain,
    ]);
  });

  it("keeps only recurring tasks in the recurring mode", () => {
    expect(applyRecurringFilter([recurring, plain], "recurring")).toEqual([
      recurring,
    ]);
  });

  it("keeps only non-recurring tasks in the non-recurring mode", () => {
    expect(applyRecurringFilter([recurring, plain], "non-recurring")).toEqual([
      plain,
    ]);
  });

  it("treats tasks without the recurrence field as non-recurring", () => {
    const noField: { id: string; recurrence?: TaskRecurrence | null } = {
      id: "n",
    };
    expect(applyRecurringFilter([noField], "non-recurring")).toEqual([
      noField,
    ]);
    expect(applyRecurringFilter([noField], "recurring")).toEqual([]);
  });
});
