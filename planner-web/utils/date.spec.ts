import { describe, expect, it } from "vitest";
import { formatLocalDate } from "./date";

// Exercises a positive-UTC-offset timezone where toISOString() shifts a
// local-midnight date to the previous day (set before any Date is built)
process.env.TZ = "Europe/Paris";

describe("formatLocalDate", () => {
  it("keeps a local-midnight date on the same calendar day (UTC+)", () => {
    const date = new Date(2026, 9, 2); // Oct 2, local midnight in Paris
    // The old toISOString() approach would have produced "2026-10-01"
    expect(date.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(formatLocalDate(date)).toBe("2026-10-02");
  });

  it("pads single-digit months and days", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles month and year boundaries", () => {
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(formatLocalDate(new Date(2027, 0, 1))).toBe("2027-01-01");
  });

  it("ignores the time of day", () => {
    expect(formatLocalDate(new Date(2026, 9, 2, 23, 59, 59))).toBe(
      "2026-10-02",
    );
    expect(formatLocalDate(new Date(2026, 9, 2, 0, 0, 0))).toBe("2026-10-02");
  });
});
