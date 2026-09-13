import {
  DEFAULT_STATUS_COLOR,
  normalizeStatusCatalog,
  seedStatusOrder,
} from "./StatusesData";

describe("seedStatusOrder", () => {
  it("should seed To Do, In Progress, Done with their default colors when there are no projects", () => {
    const expected = [
      { name: "To Do", color: "#3b82f6" },
      { name: "In Progress", color: "#f59e0b" },
      { name: "Done", color: "#22c55e" },
    ];
    expect(seedStatusOrder([])).toEqual(expected);
    expect(seedStatusOrder([[]])).toEqual(expected);
  });

  it("should preserve To Do, In Progress, Done for default projects", () => {
    expect(seedStatusOrder([["To Do", "In Progress", "Done"]])).toEqual([
      { name: "To Do", color: "#3b82f6" },
      { name: "In Progress", color: "#f59e0b" },
      { name: "Done", color: "#22c55e" },
    ]);
  });

  it("should deduplicate statuses across projects and force Done last", () => {
    expect(
      seedStatusOrder([
        ["Backlog", "To Do", "Done"],
        ["To Do", "In Progress", "Done"],
      ]),
    ).toEqual([
      { name: "To Do", color: "#3b82f6" },
      { name: "In Progress", color: "#f59e0b" },
      { name: "Backlog", color: DEFAULT_STATUS_COLOR },
      { name: "Done", color: "#22c55e" },
    ]);
  });

  it("should always include Done even when no project has it", () => {
    expect(seedStatusOrder([["To Do"]])).toEqual([
      { name: "To Do", color: "#3b82f6" },
      { name: "In Progress", color: "#f59e0b" },
      { name: "Done", color: "#22c55e" },
    ]);
  });
});

describe("normalizeStatusCatalog", () => {
  it("should normalize legacy plain-string entries to entries with the default color", () => {
    expect(normalizeStatusCatalog(["To Do", "Done"])).toEqual([
      { name: "To Do", color: DEFAULT_STATUS_COLOR },
      { name: "Done", color: DEFAULT_STATUS_COLOR },
    ]);
  });

  it("should keep entries that already have a valid color", () => {
    expect(
      normalizeStatusCatalog([
        { name: "To Do", color: "#3b82f6" },
        { name: "Done", color: "#22C55E" },
      ]),
    ).toEqual([
      { name: "To Do", color: "#3b82f6" },
      { name: "Done", color: "#22C55E" },
    ]);
  });

  it("should replace invalid or missing colors with the default color", () => {
    expect(
      normalizeStatusCatalog([
        { name: "Blocked", color: "red" },
        { name: "Review", color: "#12345" },
        { name: "Waiting" },
        { name: "Done", color: null },
      ]),
    ).toEqual([
      { name: "Blocked", color: DEFAULT_STATUS_COLOR },
      { name: "Review", color: DEFAULT_STATUS_COLOR },
      { name: "Waiting", color: DEFAULT_STATUS_COLOR },
      { name: "Done", color: DEFAULT_STATUS_COLOR },
    ]);
  });

  it("should drop empty and malformed entries", () => {
    expect(
      normalizeStatusCatalog(["", "   ", null, 42, { color: "#ff0000" }]),
    ).toEqual([]);
  });

  it("should return an empty array for non-array input", () => {
    expect(normalizeStatusCatalog(null)).toEqual([]);
    expect(normalizeStatusCatalog("To Do")).toEqual([]);
    expect(normalizeStatusCatalog({ name: "To Do" })).toEqual([]);
  });
});
