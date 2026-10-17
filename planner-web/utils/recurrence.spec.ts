import { describe, expect, it } from "vitest";
import { recurrenceLabel } from "./recurrence";

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
