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
