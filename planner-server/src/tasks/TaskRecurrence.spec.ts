import { parseRecurrence, computeNextDueDate, buildNextOccurrence } from "./TaskRecurrence";
import { Task } from "../model/Task";

describe("parseRecurrence", () => {
  it("should accept a valid daily rule", () => {
    expect(parseRecurrence({ frequency: "daily", interval: 3 })).toEqual({
      recurrence: { frequency: "daily", interval: 3 },
    });
  });

  it("should accept a valid weekly rule with weekdays", () => {
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: [1, 5] }),
    ).toEqual({
      recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 5] },
    });
  });

  it("should accept a valid monthly rule and drop an empty weekday list", () => {
    expect(parseRecurrence({ frequency: "monthly", interval: 2 })).toEqual({
      recurrence: { frequency: "monthly", interval: 2 },
    });
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: [] }),
    ).toEqual({
      recurrence: { frequency: "weekly", interval: 1 },
    });
  });

  it("should de-duplicate weekdays", () => {
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: [1, 1, 3] }),
    ).toEqual({
      recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3] },
    });
  });

  it("should reject non-object shapes", () => {
    expect(parseRecurrence(null).error).toBeTruthy();
    expect(parseRecurrence(undefined).error).toBeTruthy();
    expect(parseRecurrence("daily").error).toBeTruthy();
    expect(parseRecurrence(42).error).toBeTruthy();
    expect(parseRecurrence([]).error).toBeTruthy();
  });

  it("should reject unknown frequencies", () => {
    expect(
      parseRecurrence({ frequency: "yearly", interval: 1 }).error,
    ).toBeTruthy();
    expect(parseRecurrence({ interval: 1 }).error).toBeTruthy();
  });

  it("should reject out-of-range or non-integer intervals", () => {
    expect(parseRecurrence({ frequency: "daily", interval: 0 }).error).toBeTruthy();
    expect(parseRecurrence({ frequency: "daily", interval: 1000 }).error).toBeTruthy();
    expect(parseRecurrence({ frequency: "daily", interval: 1.5 }).error).toBeTruthy();
    expect(parseRecurrence({ frequency: "daily" }).error).toBeTruthy();
    expect(parseRecurrence({ frequency: "daily", interval: "2" }).error).toBeTruthy();
  });

  it("should reject invalid weekday values", () => {
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: [7] })
        .error,
    ).toBeTruthy();
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: [-1] })
        .error,
    ).toBeTruthy();
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: ["1"] })
        .error,
    ).toBeTruthy();
    expect(
      parseRecurrence({ frequency: "weekly", interval: 1, weekdays: 1 })
        .error,
    ).toBeTruthy();
  });
});

describe("computeNextDueDate", () => {
  it("should shift daily rules by interval days", () => {
    expect(
      computeNextDueDate({ frequency: "daily", interval: 1 }, "2026-10-16"),
    ).toBe("2026-10-17");
    expect(
      computeNextDueDate({ frequency: "daily", interval: 3 }, "2026-10-30"),
    ).toBe("2026-11-02");
  });

  it("should shift weekly rules without weekdays by interval weeks", () => {
    expect(
      computeNextDueDate({ frequency: "weekly", interval: 1 }, "2026-10-16"),
    ).toBe("2026-10-23");
    expect(
      computeNextDueDate({ frequency: "weekly", interval: 2 }, "2026-10-16"),
    ).toBe("2026-10-30");
  });

  it("should pick the next day in the weekday set, strictly after the due date", () => {
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [1] };
    // 2026-10-14 is a Wednesday; the next Monday is the 19th
    expect(computeNextDueDate(rule, "2026-10-14")).toBe("2026-10-19");
    // 2026-10-19 is a Monday; the next Monday in the set is the 26th
    expect(computeNextDueDate(rule, "2026-10-19")).toBe("2026-10-26");
  });

  it("should wrap to the next week across month and year boundaries", () => {
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [1] };
    // 2026-10-31 is a Saturday; the next Monday is Nov 2
    expect(computeNextDueDate(rule, "2026-10-31")).toBe("2026-11-02");
    // 2026-12-28 is a Monday; the next Monday is Jan 4, 2027
    expect(computeNextDueDate(rule, "2026-12-28")).toBe("2027-01-04");
  });

  it("should shift monthly rules by interval months", () => {
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 1 }, "2026-10-16"),
    ).toBe("2026-11-16");
    expect(
      computeNextDueDate({ frequency: "monthly", interval: 3 }, "2026-10-16"),
    ).toBe("2027-01-16");
  });

  it("should clamp monthly rules to the target month's last day", () => {
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

  it("should return null for a missing or malformed due date", () => {
    expect(computeNextDueDate({ frequency: "daily", interval: 1 })).toBeNull();
    expect(computeNextDueDate({ frequency: "daily", interval: 1 }, "")).toBeNull();
    expect(computeNextDueDate({ frequency: "daily", interval: 1 }, "garbage")).toBeNull();
    expect(computeNextDueDate({ frequency: "daily", interval: 1 }, "2026-13-40")).toBeNull();
  });
});

describe("buildNextOccurrence", () => {
  function makeCompleted(): Task {
    const task = new Task();
    task.projectId = "proj-1";
    task.title = "Water the plants";
    task.description = "Every week";
    task.status = "Done";
    task.priority = "high";
    task.dueDate = "2026-10-14";
    task.labels = ["chore"];
    task.assignees = [{ userId: "user-1" }, { userId: "user-2", userName: "Two" }];
    task.checklist = [
      { text: "step one", done: true },
      { text: "step two", done: false },
    ];
    task.recurrence = { frequency: "weekly", interval: 1, weekdays: [3] };
    task.comments = [
      {
        id: "comment-1",
        userId: "user-1",
        text: "hello",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];
    task.attachments = [
      {
        id: "att-1",
        fileName: "spec.pdf",
        filePath: "/data/attachments/tasks/att-1.pdf",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];
    task.dependencies = [{ taskId: "task-dep-1" }];
    return task;
  }

  it("should carry over fields and reset the checklist", () => {
    const completed = makeCompleted();
    const next = buildNextOccurrence(completed, "To Do");

    expect(next.id).toBeTruthy();
    expect(next.id).not.toBe(completed.id);
    expect(next.projectId).toBe("proj-1");
    expect(next.title).toBe("Water the plants");
    expect(next.description).toBe("Every week");
    expect(next.status).toBe("To Do");
    expect(next.priority).toBe("high");
    expect(next.labels).toEqual(["chore"]);
    expect(next.assignees).toEqual([{ userId: "user-1" }, { userId: "user-2" }]);
    expect(next.checklist).toEqual([
      { text: "step one", done: false },
      { text: "step two", done: false },
    ]);
    expect(next.recurrence).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: [3],
    });
    expect(next.dueDate).toBe("2026-10-21");
  });

  it("should not carry over comments, attachments or dependencies", () => {
    const next = buildNextOccurrence(makeCompleted(), "To Do");
    expect(next.comments).toEqual([]);
    expect(next.attachments).toEqual([]);
    expect(next.dependencies).toEqual([]);
  });

  it("should strip the cancelled suffix from the title", () => {
    const completed = makeCompleted();
    completed.title = "Water the plants [cancelled]";
    const next = buildNextOccurrence(completed, "To Do");
    expect(next.title).toBe("Water the plants");
  });

  it("should keep the completed task's status when no first status is given", () => {
    const next = buildNextOccurrence(makeCompleted());
    expect(next.status).toBe("Done");
  });

  it("should deep-copy the recurrence and the checklist", () => {
    const completed = makeCompleted();
    const next = buildNextOccurrence(completed, "To Do");

    next.recurrence.weekdays.push(5);
    next.checklist[0].done = true;

    expect(completed.recurrence.weekdays).toEqual([3]);
    expect(completed.checklist[0].done).toBe(true);
  });
});
