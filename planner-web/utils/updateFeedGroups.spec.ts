import { describe, expect, it } from "vitest";
import { formatDayGroupLabel, groupEntriesByDay } from "./updateFeedGroups";
import type { UpdateFeedEntry } from "../stores/tasks";

// Exercises a positive-UTC-offset timezone where a UTC-based day split would
// shift local-morning entries to the previous day (set before any Date)
process.env.TZ = "Europe/Paris";

function entry(id: string, dateCreated: string): UpdateFeedEntry {
  return {
    id,
    taskId: `task-${id}`,
    taskTitle: `Task ${id}`,
    actorName: "Alice",
    summary: "did something",
    dateCreated,
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
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["a", "b"]);
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
    expect(groups[1]?.entries.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("merges entries of one day across a page boundary", () => {
    const page1 = [entry("a", "2026-10-01T10:00:00")];
    const page2 = [entry("b", "2026-10-01T08:00:00"), entry("c", "2026-09-30T09:00:00")];
    // The page groups the accumulated flat list after appending a page
    const groups = groupEntriesByDay([...page1, ...page2], NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["a", "b"]);
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
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns an empty array for an empty feed", () => {
    expect(groupEntriesByDay([], NOW)).toEqual([]);
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
