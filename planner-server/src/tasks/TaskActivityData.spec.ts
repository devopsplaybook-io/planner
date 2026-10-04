import { buildListActivityQuery } from "./TaskActivityData";

const SQL_PREFIX =
  "SELECT a.id, a.taskId, a.summary, a.dateCreated, u.name AS actorName, " +
  "t.title AS taskTitle, t.projectId AS projectId, t.status AS status " +
  "FROM task_activity a " +
  "JOIN tasks t ON t.id = a.taskId LEFT JOIN users u ON u.id = a.actorUserId WHERE ";

describe("buildListActivityQuery", () => {
  it("should scope the feed to the tasks the user is assigned to", () => {
    const { sql, params } = buildListActivityQuery(
      { assigneeUserId: "user-1" },
      "sqlite",
    );
    expect(sql).toBe(
      SQL_PREFIX +
        "EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = a.taskId AND ta.userId = ?) " +
        "ORDER BY a.dateCreated DESC",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should AND the project visibility condition for non-admin viewers", () => {
    const { sql, params } = buildListActivityQuery(
      { assigneeUserId: "user-1", visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      SQL_PREFIX +
        "EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = a.taskId AND ta.userId = ?) " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY a.dateCreated DESC",
    );
    expect(params).toEqual(["user-1", "user-1"]);
  });

  it("should append LIMIT for a positive limit", () => {
    const { sql, params } = buildListActivityQuery(
      { assigneeUserId: "user-1", limit: 50 },
      "sqlite",
    );
    expect(sql).toBe(
      SQL_PREFIX +
        "EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = a.taskId AND ta.userId = ?) " +
        "ORDER BY a.dateCreated DESC LIMIT ?",
    );
    expect(params).toEqual(["user-1", 50]);
  });

  it("should append OFFSET only with a positive limit and offset", () => {
    const withOffsetOnly = buildListActivityQuery(
      { assigneeUserId: "user-1", offset: 50 },
      "sqlite",
    );
    expect(withOffsetOnly.sql).not.toContain("LIMIT");
    expect(withOffsetOnly.params).toEqual(["user-1"]);

    const { sql, params } = buildListActivityQuery(
      { assigneeUserId: "user-1", limit: 50, offset: 100 },
      "sqlite",
    );
    expect(sql).toBe(
      SQL_PREFIX +
        "EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = a.taskId AND ta.userId = ?) " +
        "ORDER BY a.dateCreated DESC LIMIT ? OFFSET ?",
    );
    expect(params).toEqual(["user-1", 50, 100]);
  });

  it("should quote identifiers for postgres", () => {
    const { sql, params } = buildListActivityQuery(
      {
        assigneeUserId: "user-1",
        visibleTo: { userId: "user-1" },
        limit: 50,
        offset: 100,
      },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT a."id", a."taskId", a."summary", a."dateCreated", u."name" AS "actorName", ' +
        't."title" AS "taskTitle", t."projectId" AS "projectId", t."status" AS "status" ' +
        'FROM "task_activity" a ' +
        'JOIN "tasks" t ON t."id" = a."taskId" LEFT JOIN "users" u ON u."id" = a."actorUserId" WHERE ' +
        'EXISTS (SELECT 1 FROM "task_assignees" ta WHERE ta."taskId" = a."taskId" AND ta."userId" = ?) ' +
        'AND ("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?)) ' +
        'ORDER BY a."dateCreated" DESC LIMIT ? OFFSET ?',
    );
    // Param order must match placeholder order: assignee, visibility, limit, offset
    expect(params).toEqual(["user-1", "user-1", 50, 100]);
  });

  it("should default to the configured database type (sqlite in tests)", () => {
    const { sql } = buildListActivityQuery({ assigneeUserId: "user-1" });
    expect(sql).toBe(
      SQL_PREFIX +
        "EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = a.taskId AND ta.userId = ?) " +
        "ORDER BY a.dateCreated DESC",
    );
  });
});
