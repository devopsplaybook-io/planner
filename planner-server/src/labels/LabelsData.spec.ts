import { buildLabelCountsQuery } from "./LabelsData";

describe("buildLabelCountsQuery", () => {
  it("should build an unfiltered count grouped by name (sqlite)", () => {
    const { sql, params } = buildLabelCountsQuery(
      { table: "task_labels", parentIdColumn: "taskId", parentTable: "tasks" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT name, COUNT(*) AS count FROM task_labels GROUP BY name",
    );
    expect(params).toEqual([]);
  });

  it("should quote identifiers for postgres", () => {
    const { sql } = buildLabelCountsQuery(
      { table: "task_labels", parentIdColumn: "taskId", parentTable: "tasks" },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT "name", COUNT(*) AS "count" FROM "task_labels" GROUP BY "name"',
    );
  });

  it("should add a case-insensitive substring filter for q", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "task_labels",
        parentIdColumn: "taskId",
        parentTable: "tasks",
        q: "urgent",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT name, COUNT(*) AS count FROM task_labels WHERE name LIKE ? ESCAPE '\\' GROUP BY name",
    );
    expect(params).toEqual(["%urgent%"]);
  });

  it("should use ILIKE and neutralize wildcards for postgres", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "note_labels",
        parentIdColumn: "noteId",
        parentTable: "notes",
        q: "50%_off\\",
      },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT "name", COUNT(*) AS "count" FROM "note_labels" WHERE "name" ILIKE ? ESCAPE \'\\\' GROUP BY "name"',
    );
    expect(params).toEqual(["%50\\%\\_off\\\\%"]);
  });

  it("should ignore a whitespace-only q", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "task_labels",
        parentIdColumn: "taskId",
        parentTable: "tasks",
        q: "   ",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT name, COUNT(*) AS count FROM task_labels GROUP BY name",
    );
    expect(params).toEqual([]);
  });

  it("should restrict to visible projects through the parent id subquery", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "task_labels",
        parentIdColumn: "taskId",
        parentTable: "tasks",
        userId: "user-1",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT name, COUNT(*) AS count FROM task_labels WHERE taskId IN (SELECT id FROM tasks WHERE " +
        "(projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?))) GROUP BY name",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should combine the q filter with the visibility clause in order", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "task_labels",
        parentIdColumn: "taskId",
        parentTable: "tasks",
        userId: "user-1",
        q: "urgent",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT name, COUNT(*) AS count FROM task_labels WHERE name LIKE ? ESCAPE '\\' AND taskId IN (SELECT id FROM tasks WHERE " +
        "(projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?))) GROUP BY name",
    );
    expect(params).toEqual(["%urgent%", "user-1"]);
  });

  it("should bind the visibility param to the notes parent table", () => {
    const { sql, params } = buildLabelCountsQuery(
      {
        table: "note_labels",
        parentIdColumn: "noteId",
        parentTable: "notes",
        userId: "user-1",
      },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT "name", COUNT(*) AS "count" FROM "note_labels" WHERE "noteId" IN (SELECT "id" FROM "notes" WHERE ' +
        '("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?))) GROUP BY "name"',
    );
    expect(params).toEqual(["user-1"]);
  });
});
