import { describe, expect, it } from "vitest";
import { buildDatedTitle, cronLabel } from "./taskTemplate";

describe("buildDatedTitle", () => {
  it("should zero-pad month and day", () => {
    expect(buildDatedTitle("Report", new Date(2026, 0, 5))).toBe(
      "Report 2026.01.05",
    );
    expect(buildDatedTitle("Report", new Date(2026, 9, 17))).toBe(
      "Report 2026.10.17",
    );
  });

  it("should match the server-side suffix format", () => {
    // Mirrors planner-server buildDatedTitle so the UI preview equals the
    // title the created task will actually get
    expect(buildDatedTitle("Water the plants", new Date(2026, 11, 31))).toBe(
      "Water the plants 2026.12.31",
    );
  });
});

describe("cronLabel", () => {
  it("should label the daily schedule", () => {
    expect(cronLabel("0 0 * * *")).toBe("Every day at 00:00");
  });

  it("should label weekday schedules", () => {
    expect(cronLabel("0 0 * * 1,3")).toBe("Every Monday, Wednesday at 00:00");
    expect(cronLabel("0 0 * * 1")).toBe("Every Monday at 00:00");
    expect(cronLabel("0 0 * * 0,6")).toBe("Every Sunday, Saturday at 00:00");
  });

  it("should label day-of-month schedules", () => {
    expect(cronLabel("0 0 15 * *")).toBe(
      "On day 15 of the month at 00:00",
    );
  });

  it("should fall back to the raw expression for unknown shapes", () => {
    expect(cronLabel("30 8 * * 1")).toBe("30 8 * * 1");
    expect(cronLabel("0 0 * * 9")).toBe("0 0 * * 9");
    expect(cronLabel("0 0 L * *")).toBe("0 0 L * *");
    expect(cronLabel("not a cron")).toBe("not a cron");
  });

  it("should return an empty string for no schedule", () => {
    expect(cronLabel(null)).toBe("");
    expect(cronLabel(undefined)).toBe("");
    expect(cronLabel("")).toBe("");
  });
});
