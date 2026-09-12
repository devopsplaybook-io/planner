import {
  removedStatusesInUse,
  validateStatusCatalog,
} from "./StatusesRoutes";

describe("validateStatusCatalog", () => {
  it("should return null for a valid catalog with Done last", () => {
    expect(validateStatusCatalog(["To Do", "In Progress", "Done"])).toBeNull();
    expect(validateStatusCatalog(["Backlog", "Active", "Review", "Done"])).toBeNull();
    expect(validateStatusCatalog(["To Do", "Done"])).toBeNull();
  });

  it("should reject arrays with fewer than 2 items", () => {
    expect(validateStatusCatalog(["Done"])).toBe(
      "At least 2 statuses are required",
    );
    expect(validateStatusCatalog([])).toBe(
      "At least 2 statuses are required",
    );
  });

  it("should reject when Done is missing", () => {
    expect(validateStatusCatalog(["To Do", "In Progress"])).toBe(
      '"Done" must be included',
    );
  });

  it("should reject when Done is not the last status", () => {
    expect(validateStatusCatalog(["Done", "To Do"])).toBe(
      '"Done" must be the last status',
    );
    expect(validateStatusCatalog(["To Do", "Done", "In Progress"])).toBe(
      '"Done" must be the last status',
    );
  });

  it("should reject duplicate statuses", () => {
    expect(validateStatusCatalog(["To Do", "To Do", "Done"])).toBe(
      "Duplicate statuses are not allowed",
    );
  });

  it("should reject empty-string statuses", () => {
    expect(validateStatusCatalog(["To Do", "", "Done"])).toBe(
      "All statuses must be non-empty strings",
    );
  });

  it("should reject non-array input", () => {
    expect(validateStatusCatalog(null as unknown as string[])).toBe(
      "At least 2 statuses are required",
    );
    expect(validateStatusCatalog(undefined as unknown as string[])).toBe(
      "At least 2 statuses are required",
    );
  });
});

describe("removedStatusesInUse", () => {
  it("should return removed statuses that are still used by projects", () => {
    const current = ["To Do", "In Progress", "Blocked", "Done"];
    const next = ["To Do", "In Progress", "Done"];
    const projects = [["To Do", "Blocked", "Done"], ["In Progress", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual(["Blocked"]);
  });

  it("should return an empty array when removed statuses are unused", () => {
    const current = ["To Do", "Blocked", "Done"];
    const next = ["To Do", "Done"];
    const projects = [["To Do", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual([]);
  });

  it("should return each in-use status only once", () => {
    const current = ["To Do", "Blocked", "Done"];
    const next = ["To Do", "Done"];
    const projects = [["Blocked", "Done"], ["To Do", "Blocked", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual(["Blocked"]);
  });

  it("should ignore statuses kept in the catalog", () => {
    const current = ["To Do", "Done"];
    const next = ["In Progress", "To Do", "Done"];
    const projects = [["To Do", "Done"]];
    expect(removedStatusesInUse(current, next, projects)).toEqual([]);
  });
});
