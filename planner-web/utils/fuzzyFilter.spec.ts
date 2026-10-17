import { describe, expect, it } from "vitest";
import { filterAndSort, fuzzyScore } from "./fuzzyFilter";

describe("fuzzyScore", () => {
  it("should match a subsequence case-insensitively", () => {
    expect(fuzzyScore("ctk", "Create Task")).toBeGreaterThanOrEqual(0);
  });

  it("should return -1 when the query does not match", () => {
    expect(fuzzyScore("xyz", "Create Task")).toBe(-1);
    // Query characters must appear in order
    expect(fuzzyScore("tc", "task")).toBe(-1);
  });

  it("should prefer start-of-word matches over mid-word ones", () => {
    expect(fuzzyScore("task", "Task report")).toBeGreaterThan(
      fuzzyScore("task", "Create task"),
    );
  });

  it("should prefer contiguous matches", () => {
    expect(fuzzyScore("rep", "Report")).toBeGreaterThan(
      fuzzyScore("rep", "Regular expense paid"),
    );
  });

  it("should return 0 for an empty or whitespace query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });
});

describe("filterAndSort", () => {
  const items = ["Write report", "Report template", "Weekly update"];

  it("should keep matching items and drop non-matching ones", () => {
    const result = filterAndSort(items, "report", (item) => item);
    expect(result).toHaveLength(2);
    expect(result).toContain("Write report");
    expect(result).toContain("Report template");
  });

  it("should order by match quality, best first", () => {
    const result = filterAndSort(items, "report", (item) => item);
    expect(result[0]).toBe("Report template");
  });

  it("should keep the original order for equal scores", () => {
    const result = filterAndSort(["Cat", "Bat"], "at", (item) => item);
    expect(result).toEqual(["Cat", "Bat"]);
  });

  it("should return the items unchanged for an empty query", () => {
    expect(filterAndSort(items, "", (item) => item)).toEqual(items);
  });

  it("should rank items by the text chosen by the getter", () => {
    const objects = [
      { id: "1", title: "Note about testing" },
      { id: "2", title: "Groceries" },
    ];
    const result = filterAndSort(objects, "test", (o) => o.title);
    expect(result).toEqual([{ id: "1", title: "Note about testing" }]);
  });
});
