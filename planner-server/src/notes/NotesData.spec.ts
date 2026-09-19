import { buildListNotesQuery } from "./NotesData";

describe("buildListNotesQuery", () => {
  it("should build an unfiltered query when no filters are set", () => {
    const { sql, params } = buildListNotesQuery({}, "sqlite");
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should filter by project", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should restrict to visible projects when visibleTo is set", () => {
    const { sql, params } = buildListNotesQuery(
      { visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should combine projectId and visibility in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });

  it("should quote identifiers for postgres while keeping ? placeholders", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", visibleTo: { userId: "user-1" } },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM notes WHERE "projectId" = ? ' +
        'AND ("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?)) ' +
        'ORDER BY "dateCreated" DESC',
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });
});

describe("buildListNotesQuery projectIds (subtree)", () => {
  it("should filter by a single project id", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should build one placeholder per id with params in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1", "proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?, ?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should ignore an empty projectIds array", () => {
    const { sql, params } = buildListNotesQuery({ projectIds: [] }, "sqlite");
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should AND projectId and projectIds when both are set", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", projectIds: ["proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? AND projectId IN (?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should combine projectIds with visibility in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1"], visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?) " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });

  it("should quote identifiers for postgres in the IN clause", () => {
    const { sql } = buildListNotesQuery(
      { projectIds: ["proj-1", "proj-2"] },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM notes WHERE "projectId" IN (?, ?) ORDER BY "dateCreated" DESC',
    );
  });
});
