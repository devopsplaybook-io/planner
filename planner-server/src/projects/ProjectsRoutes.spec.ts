import { validateStatuses } from "./ProjectsRoutes";

describe("validateStatuses", () => {
  it("should return null for valid statuses with Done last", () => {
    expect(validateStatuses(["To Do", "In Progress", "Done"])).toBeNull();
    expect(
      validateStatuses(["Backlog", "Active", "Review", "Done"]),
    ).toBeNull();
    expect(validateStatuses(["To Do", "Done"])).toBeNull();
  });

  it("should reject arrays with fewer than 2 items", () => {
    expect(validateStatuses(["Done"])).toBe("At least 2 statuses are required");
    expect(validateStatuses([])).toBe("At least 2 statuses are required");
  });

  it("should reject when Done is not the last status", () => {
    expect(validateStatuses(["Done", "To Do", "In Progress"])).toBe(
      '"Done" must be the last status',
    );
  });

  it("should reject when Done is missing entirely", () => {
    expect(validateStatuses(["To Do", "In Progress"])).toBe(
      '"Done" must be the last status',
    );
  });

  it("should reject duplicate statuses", () => {
    expect(validateStatuses(["To Do", "To Do", "Done"])).toBe(
      "Duplicate statuses are not allowed",
    );
  });

  it("should reject empty-string statuses", () => {
    expect(validateStatuses(["To Do", "", "Done"])).toBe(
      "All statuses must be non-empty strings",
    );
  });

  it("should reject non-array input", () => {
    expect(validateStatuses(null as unknown as string[])).toBe(
      "At least 2 statuses are required",
    );
  });
});
