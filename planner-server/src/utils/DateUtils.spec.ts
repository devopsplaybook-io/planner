import { formatLocalDate } from "./DateUtils";

describe("formatLocalDate", () => {
  it("should format a local calendar date as YYYY-MM-DD with zero padding", () => {
    // Local-time constructor: the expected output is independent of the
    // process timezone, exactly what the formatter must produce
    expect(formatLocalDate(new Date(2026, 9, 19))).toBe("2026-10-19");
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("should keep the calendar day of an instant (never shift to UTC)", () => {
    // Local midnight in a positive-UTC-offset timezone is the previous UTC
    // day: toISOString() would shift the day backwards, this must not
    const localMidnight = new Date(2026, 9, 19, 0, 0, 0, 0);
    expect(formatLocalDate(localMidnight)).toBe("2026-10-19");
  });
});
