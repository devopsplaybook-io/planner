import { buildAttachmentsQuery, buildDoneTasksQuery } from "./CleanupData";

describe("buildDoneTasksQuery", () => {
  it("should build a sqlite query with bare identifiers and ? placeholders", () => {
    const { sql, params } = buildDoneTasksQuery(
      "p1",
      "2026-10-01T00:00:00.000Z",
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND status = 'Done' AND dateUpdated < ?",
    );
    expect(params).toEqual(["p1", "2026-10-01T00:00:00.000Z"]);
  });

  it("should quote identifiers for postgres", () => {
    const { sql, params } = buildDoneTasksQuery(
      "p1",
      "2026-10-01T00:00:00.000Z",
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM tasks WHERE "projectId" = ? AND "status" = \'Done\' AND "dateUpdated" < ?',
    );
    expect(params).toEqual(["p1", "2026-10-01T00:00:00.000Z"]);
  });

  it("should default to the configured database type (sqlite in tests)", () => {
    const { sql } = buildDoneTasksQuery("p1", "2026-10-01T00:00:00.000Z");
    expect(sql).toBe(
      "SELECT * FROM tasks WHERE projectId = ? AND status = 'Done' AND dateUpdated < ?",
    );
  });
});

describe("buildAttachmentsQuery", () => {
  it("should join task_attachments with tasks for sqlite", () => {
    const { sql, params } = buildAttachmentsQuery(
      "p1",
      "2026-10-01T00:00:00.000Z",
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT a.* FROM task_attachments a JOIN tasks t ON a.taskId = t.id WHERE t.projectId = ? AND a.dateCreated < ?",
    );
    expect(params).toEqual(["p1", "2026-10-01T00:00:00.000Z"]);
  });

  it("should quote identifiers for postgres", () => {
    const { sql } = buildAttachmentsQuery(
      "p1",
      "2026-10-01T00:00:00.000Z",
      "postgres",
    );
    expect(sql).toBe(
      'SELECT a.* FROM task_attachments a JOIN tasks t ON a."taskId" = t."id" WHERE t."projectId" = ? AND a."dateCreated" < ?',
    );
  });
});
