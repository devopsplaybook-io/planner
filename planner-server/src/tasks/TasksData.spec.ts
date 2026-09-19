import { buildListTasksQuery } from "./TasksData";

describe("buildListTasksQuery", () => {
  it("should build an unfiltered query with no params", () => {
    const { sql, params } = buildListTasksQuery({}, "sqlite");
    expect(sql).toBe("SELECT * FROM tasks ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should filter by projectId only", () => {
    const { sql, params } = buildListTasksQuery(
      { projectId: "proj-1" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should filter by doneSince only, keeping all non-Done tasks", () => {
    const { sql, params } = buildListTasksQuery(
      { doneSince: "2026-08-14T00:00:00.000Z" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE (status != ? OR dateUpdated >= ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["Done", "2026-08-14T00:00:00.000Z"]);
  });

  it("should combine projectId and doneSince filters", () => {
    const { sql, params } = buildListTasksQuery(
      { projectId: "proj-1", doneSince: "2026-08-14T00:00:00.000Z" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND (status != ? OR dateUpdated >= ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "Done", "2026-08-14T00:00:00.000Z"]);
  });

  it("should quote identifiers for postgres", () => {
    const { sql } = buildListTasksQuery(
      { projectId: "proj-1", doneSince: "2026-08-14T00:00:00.000Z" },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM tasks WHERE "projectId" = ? AND ("status" != ? OR "dateUpdated" >= ?) ORDER BY "dateCreated" DESC',
    );
  });

  it("should default to the configured database type (sqlite in tests)", () => {
    const { sql } = buildListTasksQuery({ projectId: "proj-1" });
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? ORDER BY dateCreated DESC",
    );
  });

  it("should use ? placeholders that DbUtilsQuerySQL renumbers for postgres", () => {
    const { params } = buildListTasksQuery(
      { projectId: "proj-1", doneSince: "2026-08-14T00:00:00.000Z" },
      "postgres",
    );
    // Param order must match placeholder order: projectId, status, doneSince
    expect(params).toEqual(["proj-1", "Done", "2026-08-14T00:00:00.000Z"]);
  });
});

describe("buildListTasksQuery projectIds (subtree)", () => {
  it("should filter by a single project id", () => {
    const { sql, params } = buildListTasksQuery(
      { projectIds: ["proj-1"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId IN (?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should build one placeholder per id with params in order", () => {
    const { sql, params } = buildListTasksQuery(
      { projectIds: ["proj-1", "proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId IN (?, ?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should ignore an empty projectIds array", () => {
    const { sql, params } = buildListTasksQuery(
      { projectIds: [] },
      "sqlite",
    );
    expect(sql).toBe("SELECT * FROM tasks ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should AND projectId and projectIds when both are set", () => {
    const { sql, params } = buildListTasksQuery(
      { projectId: "proj-1", projectIds: ["proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND projectId IN (?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should combine projectIds with doneSince, q and visibility in order", () => {
    const { sql, params } = buildListTasksQuery(
      {
        projectIds: ["proj-1", "proj-2"],
        doneSince: "2026-08-14T00:00:00.000Z",
        q: "report",
        visibleTo: { userId: "user-1" },
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId IN (?, ?) AND (status != ? OR dateUpdated >= ?) " +
        "AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual([
      "proj-1",
      "proj-2",
      "Done",
      "2026-08-14T00:00:00.000Z",
      "%report%",
      "%report%",
      "user-1",
    ]);
  });

  it("should quote identifiers for postgres in the IN clause", () => {
    const { sql } = buildListTasksQuery(
      { projectIds: ["proj-1", "proj-2"] },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM tasks WHERE "projectId" IN (?, ?) ORDER BY "dateCreated" DESC',
    );
  });
});

describe("buildListTasksQuery search (q)", () => {
  it("should match title or description case-insensitively (sqlite)", () => {
    const { sql, params } = buildListTasksQuery({ q: "report" }, "sqlite");
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["%report%", "%report%"]);
  });

  it("should use ILIKE for postgres", () => {
    const { sql, params } = buildListTasksQuery({ q: "report" }, "postgres");
    expect(sql).toBe(
      'SELECT * FROM tasks WHERE ("title" ILIKE ? ESCAPE \'\\\' OR "description" ILIKE ? ESCAPE \'\\\') ORDER BY "dateCreated" DESC',
    );
    expect(params).toEqual(["%report%", "%report%"]);
  });

  it("should trim the search term", () => {
    const { params } = buildListTasksQuery({ q: "  report  " }, "sqlite");
    expect(params).toEqual(["%report%", "%report%"]);
  });

  it("should escape LIKE wildcards and the escape character in q", () => {
    const { params } = buildListTasksQuery({ q: "50%_off\\" }, "sqlite");
    expect(params).toEqual(["%50\\%\\_off\\\\%", "%50\\%\\_off\\\\%"]);
  });

  it("should combine q with projectId and doneSince", () => {
    const { sql, params } = buildListTasksQuery(
      {
        projectId: "proj-1",
        doneSince: "2026-08-14T00:00:00.000Z",
        q: "report",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND (status != ? OR dateUpdated >= ?) " +
        "AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY dateCreated DESC",
    );
    expect(params).toEqual([
      "proj-1",
      "Done",
      "2026-08-14T00:00:00.000Z",
      "%report%",
      "%report%",
    ]);
  });

  it("should ignore an empty or whitespace-only q", () => {
    expect(buildListTasksQuery({ q: "" }, "sqlite").sql).toBe(
      "SELECT * FROM tasks ORDER BY dateCreated DESC",
    );
    expect(buildListTasksQuery({ q: "   " }, "sqlite").sql).toBe(
      "SELECT * FROM tasks ORDER BY dateCreated DESC",
    );
    expect(buildListTasksQuery({ q: "" }, "sqlite").params).toEqual([]);
  });
});

describe("buildListTasksQuery visibility", () => {
  it("should add no visibility clause when visibleTo is absent (admin)", () => {
    const { sql, params } = buildListTasksQuery({}, "sqlite");
    expect(sql).toBe("SELECT * FROM tasks ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should restrict to visible projects when visibleTo is set", () => {
    const { sql, params } = buildListTasksQuery(
      { visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should quote identifiers for postgres in the visibility clause", () => {
    const { sql } = buildListTasksQuery(
      { visibleTo: { userId: "user-1" } },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM tasks WHERE ("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?)) ' +
        'ORDER BY "dateCreated" DESC',
    );
  });

  it("should combine projectId, doneSince and visibility in order", () => {
    const { sql, params } = buildListTasksQuery(
      {
        projectId: "proj-1",
        doneSince: "2026-08-14T00:00:00.000Z",
        visibleTo: { userId: "user-1" },
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND (status != ? OR dateUpdated >= ?) " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual([
      "proj-1",
      "Done",
      "2026-08-14T00:00:00.000Z",
      "user-1",
    ]);
  });
});
