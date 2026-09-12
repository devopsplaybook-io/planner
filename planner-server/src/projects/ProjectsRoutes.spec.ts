import {
  normalizeStatusSelection,
  validateProjectStatusSelection,
} from "./ProjectsRoutes";

const CATALOG = ["Backlog", "To Do", "In Progress", "Review", "Done"];

describe("validateProjectStatusSelection", () => {
  it("should return null for a valid selection from the catalog", () => {
    expect(
      validateProjectStatusSelection(["To Do", "In Progress", "Done"], CATALOG),
    ).toBeNull();
    expect(validateProjectStatusSelection(["Backlog", "Done"], CATALOG)).toBeNull();
  });

  it("should reject arrays with fewer than 2 items", () => {
    expect(validateProjectStatusSelection(["Done"], CATALOG)).toBe(
      "At least 2 statuses are required",
    );
    expect(validateProjectStatusSelection([], CATALOG)).toBe(
      "At least 2 statuses are required",
    );
  });

  it("should reject when Done is missing", () => {
    expect(validateProjectStatusSelection(["To Do", "In Progress"], CATALOG)).toBe(
      '"Done" must be included',
    );
  });

  it("should reject duplicate statuses", () => {
    expect(validateProjectStatusSelection(["To Do", "To Do", "Done"], CATALOG)).toBe(
      "Duplicate statuses are not allowed",
    );
  });

  it("should reject empty-string statuses", () => {
    expect(validateProjectStatusSelection(["To Do", "", "Done"], CATALOG)).toBe(
      "All statuses must be non-empty strings",
    );
  });

  it("should reject statuses that are not in the catalog", () => {
    expect(
      validateProjectStatusSelection(["To Do", "Archived", "Done"], CATALOG),
    ).toBe("Unknown statuses: Archived");
    expect(
      validateProjectStatusSelection(["Foo", "Bar", "Done"], CATALOG),
    ).toBe("Unknown statuses: Foo, Bar");
  });

  it("should reject non-array input", () => {
    expect(
      validateProjectStatusSelection(null as unknown as string[], CATALOG),
    ).toBe("At least 2 statuses are required");
  });
});

describe("normalizeStatusSelection", () => {
  it("should order the selection according to the catalog", () => {
    expect(
      normalizeStatusSelection(["Done", "To Do", "In Progress"], CATALOG),
    ).toEqual(["To Do", "In Progress", "Done"]);
    expect(normalizeStatusSelection(["Review", "Done"], CATALOG)).toEqual([
      "Review",
      "Done",
    ]);
  });

  it("should drop statuses that are not in the catalog", () => {
    expect(normalizeStatusSelection(["To Do", "Archived", "Done"], CATALOG)).toEqual([
      "To Do",
      "Done",
    ]);
  });
});
