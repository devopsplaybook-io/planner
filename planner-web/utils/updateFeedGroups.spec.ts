import { describe, expect, it, vi } from "vitest";
import {
  formatDayGroupLabel,
  groupConsecutiveUpdates,
  groupEntriesByDay,
} from "./updateFeedGroups";
import type { UpdateFeedEntry } from "../stores/tasks";

// Exercises a positive-UTC-offset timezone where a UTC-based day split would
// shift local-morning entries to the previous day (set before any Date)
process.env.TZ = "Europe/Paris";

function entry(
  id: string,
  dateCreated: string,
  overrides: Partial<UpdateFeedEntry> = {},
): UpdateFeedEntry {
  return {
    id,
    taskId: `task-${id}`,
    taskTitle: `Task ${id}`,
    actorName: "Alice",
    summary: "did something",
    dateCreated,
    ...overrides,
  };
}

const NOW = new Date(2026, 9, 2, 15, 0, 0); // Oct 2, 2026, local afternoon

describe("groupEntriesByDay", () => {
  it("puts entries of the same day in one group", () => {
    const groups = groupEntriesByDay(
      [entry("a", "2026-10-02T10:00:00"), entry("b", "2026-10-02T08:00:00")],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("2026-10-02");
    expect(
      groups[0]?.updateGroups.flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["a", "b"]);
  });

  it("splits different days into groups in input order", () => {
    const groups = groupEntriesByDay(
      [
        entry("a", "2026-10-02T10:00:00"),
        entry("b", "2026-10-01T10:00:00"),
        entry("c", "2026-10-01T09:00:00"),
        entry("d", "2026-09-30T10:00:00"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "2026-10-02",
      "2026-10-01",
      "2026-09-30",
    ]);
    expect(
      groups[1]?.updateGroups.flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["b", "c"]);
  });

  it("merges entries of one day across a page boundary", () => {
    const page1 = [entry("a", "2026-10-01T10:00:00")];
    const page2 = [entry("b", "2026-10-01T08:00:00"), entry("c", "2026-09-30T09:00:00")];
    // The page groups the accumulated flat list after appending a page
    const groups = groupEntriesByDay([...page1, ...page2], NOW);
    expect(groups).toHaveLength(2);
    expect(
      groups[0]?.updateGroups.flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["a", "b"]);
    expect(groups[1]?.key).toBe("2026-09-30");
  });

  it("keeps local-morning entries on their local day (UTC+)", () => {
    // 2026-10-02T00:30 local in Paris is 2026-10-01T22:30 UTC: a UTC-based
    // day key would group this entry under October 1st
    const groups = groupEntriesByDay(
      [entry("a", "2026-10-02T00:30:00+02:00")],
      NOW,
    );
    expect(groups[0]?.key).toBe("2026-10-02");
  });

  it("skips entries with an unparsable date", () => {
    const groups = groupEntriesByDay(
      [entry("a", "not-a-date"), entry("b", "2026-10-01T10:00:00")],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(
      groups[0]?.updateGroups.flatMap((g) => g.entries.map((e) => e.id)),
    ).toEqual(["b"]);
  });

  it("returns an empty array for an empty feed", () => {
    expect(groupEntriesByDay([], NOW)).toEqual([]);
  });

  it("never merges same-task entries across a day boundary", () => {
    // Same task and actor, consecutive in the feed, on two different days:
    // the day header breaks the run, so each day holds its own group
    const groups = groupEntriesByDay(
      [
        entry("a", "2026-10-02T10:00:00", { taskId: "t1", taskTitle: "Task one" }),
        entry("b", "2026-10-01T10:00:00", { taskId: "t1", taskTitle: "Task one" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-10-02", "2026-10-01"]);
    for (const day of groups) {
      expect(day.updateGroups).toHaveLength(1);
      expect(day.updateGroups[0]?.entries.map((e) => e.id)).toHaveLength(1);
    }
  });
});

describe("groupConsecutiveUpdates", () => {
  // Oct 2, 2026 15:00 local: 14:55 shows "5m ago", 14:20 shows "40m ago"
  it("groups consecutive entries with the same task, actor and displayed time", () => {
    const groups = groupConsecutiveUpdates(
      [
        entry("a", "2026-10-02T14:55:00", { taskId: "t1", taskTitle: "Task one" }),
        entry("b", "2026-10-02T14:54:30", {
          taskId: "t1",
          taskTitle: "Task one",
          summary: "did something else",
        }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(group?.key).toBe("a");
    expect(group?.taskId).toBe("t1");
    expect(group?.taskTitle).toBe("Task one");
    expect(group?.actorName).toBe("Alice");
    expect(group?.dateCreated).toBe("2026-10-02T14:55:00");
  });

  it("splits entries on different tasks", () => {
    const groups = groupConsecutiveUpdates(
      [
        entry("a", "2026-10-02T14:55:00", { taskId: "t1" }),
        entry("b", "2026-10-02T14:54:30", { taskId: "t2" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["a"], ["b"]]);
  });

  it("splits entries by different actors", () => {
    const groups = groupConsecutiveUpdates(
      [
        entry("a", "2026-10-02T14:55:00", { taskId: "t1" }),
        entry("b", "2026-10-02T14:54:30", { taskId: "t1", actorName: "Bob" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.actorName)).toEqual(["Alice", "Bob"]);
  });

  it("groups entries with a null actor together, apart from named actors", () => {
    const groups = groupConsecutiveUpdates(
      [
        entry("a", "2026-10-02T14:55:00", { taskId: "t1", actorName: null }),
        entry("b", "2026-10-02T14:54:30", { taskId: "t1", actorName: null }),
        entry("c", "2026-10-02T14:54:00", { taskId: "t1", actorName: "Bob" }),
        entry("d", "2026-10-02T14:53:30", { taskId: "t1", actorName: null }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.actorName)).toEqual([null, "Bob", null]);
  });

  it("splits entries on opposite sides of a minute boundary", () => {
    // 2026-10-02T14:59:30 is 30s old ("just now"), 14:58:50 is 70s old ("1m ago"):
    // they display different times even though they are seconds apart
    const groups = groupConsecutiveUpdates(
      [
        entry("a", "2026-10-02T14:59:30", { taskId: "t1" }),
        entry("b", "2026-10-02T14:58:50", { taskId: "t1" }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(2);
  });

  it("keeps the feed sequence: an update in between prevents grouping", () => {
    // a1, a2 and a3 are the same task/actor/displayed time, but b (another
    // task) comes between a2 and a3: three groups, no re-merge across b
    const burst = { taskId: "t1", taskTitle: "Task one" };
    const groups = groupConsecutiveUpdates(
      [
        entry("a1", "2026-10-02T14:55:00", burst),
        entry("a2", "2026-10-02T14:54:30", burst),
        entry("b", "2026-10-02T14:54:00", { taskId: "t2" }),
        entry("a3", "2026-10-02T14:53:30", burst),
      ],
      NOW,
    );
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([
      ["a1", "a2"],
      ["b"],
      ["a3"],
    ]);
  });

  it("merges a burst across a page boundary (accumulated flat list)", () => {
    const page1 = [entry("a", "2026-10-02T14:55:00", { taskId: "t1" })];
    const page2 = [entry("b", "2026-10-02T14:54:30", { taskId: "t1" })];
    const groups = groupConsecutiveUpdates([...page1, ...page2], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("returns one group per entry when nothing matches", () => {
    const entries = [
      entry("a", "2026-10-02T14:55:00", { taskId: "t1" }),
      entry("b", "2026-10-02T14:20:00", { taskId: "t1" }),
      entry("c", "2026-10-02T14:55:00", { taskId: "t2", actorName: "Bob" }),
    ];
    const groups = groupConsecutiveUpdates(entries, NOW);
    expect(groups.map((g) => g.key)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty feed and one group for a single entry", () => {
    expect(groupConsecutiveUpdates([], NOW)).toEqual([]);
    const groups = groupConsecutiveUpdates([entry("a", "2026-10-02T14:55:00")], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries).toHaveLength(1);
  });

  it("defaults to the real clock for the displayed time", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-02T15:00:00"));
      const groups = groupConsecutiveUpdates([
        entry("a", "2026-10-02T14:59:40", { taskId: "t1" }),
        entry("b", "2026-10-02T14:59:20", { taskId: "t1" }),
        entry("c", "2026-10-02T14:58:50", { taskId: "t1" }),
      ]);
      expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([
        ["a", "b"],
        ["c"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("formatDayGroupLabel", () => {
  it("labels the current day Today", () => {
    expect(formatDayGroupLabel("2026-10-02", NOW)).toBe("Today");
  });

  it("labels the previous day Yesterday", () => {
    expect(formatDayGroupLabel("2026-10-01", NOW)).toBe("Yesterday");
  });

  it("labels older days with the localized date (locale default)", () => {
    const label = formatDayGroupLabel("2026-09-30", NOW);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).toContain("2026");
  });

  it("handles the month and year boundary", () => {
    const newYear = new Date(2027, 0, 1, 12, 0, 0);
    expect(formatDayGroupLabel("2026-12-31", newYear)).toBe("Yesterday");
    expect(formatDayGroupLabel("2025-12-31", newYear)).toContain("2025");
  });
});
