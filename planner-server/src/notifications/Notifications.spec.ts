import {
  buildDigestPayload,
  formatLocalDate,
  getRecipientsForTask,
  getTaskNotificationKind,
  getZonedDateKey,
} from "./Notifications";

describe("formatLocalDate", () => {
  it("should format a date as YYYY-MM-DD with zero padding", () => {
    expect(formatLocalDate(new Date(2026, 7, 19, 10, 30))).toBe("2026-08-19");
    expect(formatLocalDate(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
    expect(formatLocalDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("getTaskNotificationKind", () => {
  const notifyHour = 9;
  // Reference "now": 2026-08-19 at 10:00 local time
  const now = new Date(2026, 7, 19, 10, 0);

  it("should return 'day-of' for a task due today", () => {
    expect(
      getTaskNotificationKind("2026-08-19", "To Do", now, notifyHour),
    ).toBe("day-of");
  });

  it("should return 'day-before' for a task due tomorrow", () => {
    expect(
      getTaskNotificationKind("2026-08-20", "To Do", now, notifyHour),
    ).toBe("day-before");
  });

  it("should handle tomorrow across a month boundary", () => {
    const endOfMonth = new Date(2026, 7, 31, 10, 0);
    expect(
      getTaskNotificationKind("2026-09-01", "To Do", endOfMonth, notifyHour),
    ).toBe("day-before");
  });

  it("should handle tomorrow across a year boundary", () => {
    const endOfYear = new Date(2026, 11, 31, 10, 0);
    expect(
      getTaskNotificationKind("2027-01-01", "To Do", endOfYear, notifyHour),
    ).toBe("day-before");
  });

  it("should return null before the notification hour", () => {
    const earlyMorning = new Date(2026, 7, 19, 8, 59);
    expect(
      getTaskNotificationKind("2026-08-19", "To Do", earlyMorning, notifyHour),
    ).toBeNull();
    expect(
      getTaskNotificationKind("2026-08-20", "To Do", earlyMorning, notifyHour),
    ).toBeNull();
  });

  it("should notify at exactly the notification hour", () => {
    const onTheHour = new Date(2026, 7, 19, 9, 0);
    expect(
      getTaskNotificationKind("2026-08-19", "To Do", onTheHour, notifyHour),
    ).toBe("day-of");
  });

  it("should return null for completed tasks", () => {
    expect(
      getTaskNotificationKind("2026-08-19", "Done", now, notifyHour),
    ).toBeNull();
    expect(
      getTaskNotificationKind("2026-08-20", "Done", now, notifyHour),
    ).toBeNull();
  });

  it("should return null when no due date is set", () => {
    expect(
      getTaskNotificationKind(undefined, "To Do", now, notifyHour),
    ).toBeNull();
    expect(getTaskNotificationKind(null, "To Do", now, notifyHour)).toBeNull();
    expect(getTaskNotificationKind("", "To Do", now, notifyHour)).toBeNull();
  });

  it("should return null for tasks due later than tomorrow", () => {
    expect(
      getTaskNotificationKind("2026-08-21", "To Do", now, notifyHour),
    ).toBeNull();
    expect(
      getTaskNotificationKind("2027-08-19", "To Do", now, notifyHour),
    ).toBeNull();
  });

  it("should return 'overdue' for tasks past their due date", () => {
    expect(
      getTaskNotificationKind("2026-08-18", "To Do", now, notifyHour),
    ).toBe("overdue");
    expect(
      getTaskNotificationKind("2025-08-19", "To Do", now, notifyHour),
    ).toBe("overdue");
  });

  it("should handle overdue across a month boundary", () => {
    const startOfMonth = new Date(2026, 8, 1, 10, 0);
    expect(
      getTaskNotificationKind("2026-08-31", "To Do", startOfMonth, notifyHour),
    ).toBe("overdue");
  });

  it("should handle overdue across a year boundary", () => {
    const startOfYear = new Date(2027, 0, 1, 10, 0);
    expect(
      getTaskNotificationKind("2026-12-31", "To Do", startOfYear, notifyHour),
    ).toBe("overdue");
  });

  it("should accept ISO datetime due dates", () => {
    expect(
      getTaskNotificationKind(
        "2026-08-19T10:00:00.000Z",
        "To Do",
        now,
        notifyHour,
      ),
    ).toBe("day-of");
  });
});

describe("getTaskNotificationKind with a timezone", () => {
  const notifyHour = 9;

  it("should use the timezone to decide which calendar day it is", () => {
    // 2026-08-26T21:00Z is still the 26th in UTC but already the 27th in UTC+14
    const instant = new Date("2026-08-26T21:00:00.000Z");
    expect(
      getTaskNotificationKind(
        "2026-08-27",
        "To Do",
        instant,
        notifyHour,
        "Pacific/Kiritimati",
      ),
    ).toBe("day-of");
    expect(
      getTaskNotificationKind(
        "2026-08-27",
        "To Do",
        instant,
        notifyHour,
        "UTC",
      ),
    ).toBe("day-before");
    // The same instant: already past in UTC+14, still today in UTC
    expect(
      getTaskNotificationKind(
        "2026-08-26",
        "To Do",
        instant,
        notifyHour,
        "Pacific/Kiritimati",
      ),
    ).toBe("overdue");
    expect(
      getTaskNotificationKind(
        "2026-08-26",
        "To Do",
        instant,
        notifyHour,
        "UTC",
      ),
    ).toBe("day-of");
  });

  it("should gate on the hour of the configured timezone", () => {
    // 2026-08-27T00:30Z is 00:30 in UTC (before 9) and 14:30 in UTC+14
    const instant = new Date("2026-08-27T00:30:00.000Z");
    expect(
      getTaskNotificationKind(
        "2026-08-27",
        "To Do",
        instant,
        notifyHour,
        "UTC",
      ),
    ).toBeNull();
    expect(
      getTaskNotificationKind(
        "2026-08-27",
        "To Do",
        instant,
        notifyHour,
        "Pacific/Kiritimati",
      ),
    ).toBe("day-of");
  });
});

describe("getZonedDateKey", () => {
  it("should roll over month and year boundaries", () => {
    const endOfMonth = new Date("2026-08-31T10:00:00.000Z");
    expect(getZonedDateKey(endOfMonth, "UTC", 1)).toBe("2026-09-01");
    const endOfYear = new Date("2026-12-31T10:00:00.000Z");
    expect(getZonedDateKey(endOfYear, "UTC", 1)).toBe("2027-01-01");
  });

  it("should return the requested day offset in the given timezone", () => {
    const instant = new Date("2026-08-26T21:00:00.000Z");
    expect(getZonedDateKey(instant, "Pacific/Kiritimati", 0)).toBe(
      "2026-08-27",
    );
    expect(getZonedDateKey(instant, "UTC", 0)).toBe("2026-08-26");
    expect(getZonedDateKey(instant, "UTC", -1)).toBe("2026-08-25");
  });
});

describe("getRecipientsForTask", () => {
  const memberOfProject = (userId: string) =>
    ["u-member-1", "u-member-2"].includes(userId);

  it("should keep only the assignees who can see the project", () => {
    expect(
      getRecipientsForTask(
        ["u-member-1", "u-outsider", "u-member-2"],
        memberOfProject,
      ),
    ).toEqual(["u-member-1", "u-member-2"]);
  });

  it("should deduplicate assignees", () => {
    expect(
      getRecipientsForTask(
        ["u-member-1", "u-member-1", "u-member-1"],
        memberOfProject,
      ),
    ).toEqual(["u-member-1"]);
  });

  it("should remind nobody for unassigned tasks", () => {
    expect(getRecipientsForTask([], memberOfProject)).toEqual([]);
  });

  it("should remind nobody when no assignee can see the project", () => {
    expect(
      getRecipientsForTask(["u-outsider"], memberOfProject),
    ).toEqual([]);
  });
});

describe("buildDigestPayload", () => {
  it("should group the entries by kind, overdue first", () => {
    const payload = buildDigestPayload(
      [
        { title: "Due tomorrow task", kind: "day-before" },
        { title: "Overdue task", kind: "overdue" },
        { title: "Due today task", kind: "day-of" },
        { title: "Another overdue task", kind: "overdue" },
      ],
      "2026-10-15",
    );
    expect(payload.title).toBe("Your task reminders");
    expect(payload.body).toBe(
      "Overdue: Overdue task, Another overdue task — Due today: Due today task — Due tomorrow: Due tomorrow task",
    );
    expect(payload.url).toBe("/");
    expect(payload.tag).toBe("task-digest-2026-10-15");
  });

  it("should omit the kinds with no entry", () => {
    const payload = buildDigestPayload(
      [{ title: "Only due today", kind: "day-of" }],
      "2026-10-15",
    );
    expect(payload.body).toBe("Due today: Only due today");
  });
});
