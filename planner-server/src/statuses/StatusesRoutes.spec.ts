import {
  removedStatusesInUse,
  validateStatusCatalog,
} from "./StatusesRoutes";

describe("validateStatusCatalog", () => {
  const entry = (name: string, color: string) => ({ name, color });

  it("should return null for a valid catalog with Done last", () => {
    expect(
      validateStatusCatalog([
        entry("To Do", "#3b82f6"),
        entry("In Progress", "#f59e0b"),
        entry("Done", "#22c55e"),
      ]),
    ).toBeNull();
    expect(
      validateStatusCatalog([
        entry("Backlog", "#6b7280"),
        entry("Active", "#ef4444"),
        entry("Review", "#f59e0b"),
        entry("Done", "#22c55e"),
      ]),
    ).toBeNull();
    expect(
      validateStatusCatalog([
        entry("To Do", "#3b82f6"),
        entry("Done", "#22c55e"),
      ]),
    ).toBeNull();
  });

  it("should accept lowercase and uppercase hex colors", () => {
    expect(
      validateStatusCatalog([
        entry("To Do", "#abcdef"),
        entry("Done", "#ABCDEF"),
      ]),
    ).toBeNull();
  });

  it("should reject arrays with fewer than 2 items", () => {
    expect(validateStatusCatalog([entry("Done", "#22c55e")])).toBe(
      "At least 2 statuses are required",
    );
    expect(validateStatusCatalog([])).toBe(
      "At least 2 statuses are required",
    );
  });

  it("should reject entries that are not objects with a non-empty name", () => {
    expect(
      validateStatusCatalog(["To Do", entry("Done", "#22c55e")] as never),
    ).toBe("All statuses must be objects with a non-empty name");
    expect(
      validateStatusCatalog([null, entry("Done", "#22c55e")] as never),
    ).toBe("All statuses must be objects with a non-empty name");
    expect(
      validateStatusCatalog([
        { name: "", color: "#3b82f6" },
        entry("Done", "#22c55e"),
      ]),
    ).toBe("All statuses must be objects with a non-empty name");
  });

  it("should reject invalid colors", () => {
    for (const color of ["#fff", "#12345", "3b82f6", "#GGGGGG", "", null, 42]) {
      expect(
        validateStatusCatalog([
          entry("To Do", "#3b82f6"),
          entry("Done", color as string),
        ]),
      ).toBe("Each status color must be a valid hex color code (#RRGGBB)");
    }
  });

  it("should reject when Done is missing", () => {
    expect(
      validateStatusCatalog([
        entry("To Do", "#3b82f6"),
        entry("In Progress", "#f59e0b"),
      ]),
    ).toBe('"Done" must be included');
  });

  it("should reject when Done is not the last status", () => {
    expect(
      validateStatusCatalog([
        entry("Done", "#22c55e"),
        entry("To Do", "#3b82f6"),
      ]),
    ).toBe('"Done" must be the last status');
    expect(
      validateStatusCatalog([
        entry("To Do", "#3b82f6"),
        entry("Done", "#22c55e"),
        entry("In Progress", "#f59e0b"),
      ]),
    ).toBe('"Done" must be the last status');
  });

  it("should reject duplicate statuses", () => {
    expect(
      validateStatusCatalog([
        entry("To Do", "#3b82f6"),
        entry("To Do", "#ef4444"),
        entry("Done", "#22c55e"),
      ]),
    ).toBe("Duplicate statuses are not allowed");
  });

  it("should reject non-array input", () => {
    expect(validateStatusCatalog(null as never)).toBe(
      "At least 2 statuses are required",
    );
    expect(validateStatusCatalog(undefined as never)).toBe(
      "At least 2 statuses are required",
    );
  });
});

describe("removedStatusesInUse", () => {
  const entry = (name: string) => ({ name, color: "#6b7280" });

  it("should return removed statuses that are still used by projects", () => {
    const current = [
      entry("To Do"),
      entry("In Progress"),
      entry("Blocked"),
      entry("Done"),
    ];
    const next = [entry("To Do"), entry("In Progress"), entry("Done")];
    const projects = [
      ["To Do", "Blocked", "Done"],
      ["In Progress", "Done"],
    ];
    expect(removedStatusesInUse(current, next, projects)).toEqual(["Blocked"]);
  });

  it("should return an empty array when removed statuses are unused", () => {
    const current = [entry("To Do"), entry("Blocked"), entry("Done")];
    const next = [entry("To Do"), entry("Done")];
    const projects = [["To Do", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual([]);
  });

  it("should return each in-use status only once", () => {
    const current = [entry("To Do"), entry("Blocked"), entry("Done")];
    const next = [entry("To Do"), entry("Done")];
    const projects = [
      ["Blocked", "Done"],
      ["To Do", "Blocked", "Done"],
    ];
    expect(removedStatusesInUse(current, next, projects)).toEqual(["Blocked"]);
  });

  it("should ignore statuses kept in the catalog", () => {
    const current = [entry("To Do"), entry("Done")];
    const next = [entry("In Progress"), entry("To Do"), entry("Done")];
    const projects = [["To Do", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual([]);
  });
});
