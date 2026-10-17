import { buildListTemplatesQuery } from "./TaskTemplatesData";

describe("buildListTemplatesQuery", () => {
  it("should build an unfiltered query for sqlite", () => {
    const { sql, params } = buildListTemplatesQuery({}, "sqlite");
    expect(sql).toBe(
      "SELECT * FROM task_templates ORDER BY dateCreated DESC",
    );
    expect(params).toEqual([]);
  });

  it("should build an unfiltered query for postgres with quoted identifiers", () => {
    const { sql, params } = buildListTemplatesQuery({}, "postgres");
    expect(sql).toBe(
      'SELECT * FROM task_templates ORDER BY "dateCreated" DESC',
    );
    expect(params).toEqual([]);
  });

  it("should filter by a single project", () => {
    const { sql, params } = buildListTemplatesQuery(
      { projectId: "p1" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM task_templates WHERE projectId = ? ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["p1"]);
  });

  it("should filter by a project subtree with IN", () => {
    const { sql, params } = buildListTemplatesQuery(
      { projectIds: ["p1", "p2", "p3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM task_templates WHERE projectId IN (?, ?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["p1", "p2", "p3"]);
  });

  it("should search title and description case-insensitively per dialect", () => {
    const sqlite = buildListTemplatesQuery({ q: "  Report  " }, "sqlite");
    expect(sqlite.sql).toContain("LIKE ? ESCAPE '\\'");
    expect(sqlite.params).toEqual(["%Report%", "%Report%"]);

    const postgres = buildListTemplatesQuery({ q: "Report" }, "postgres");
    expect(postgres.sql).toContain('ILIKE ? ESCAPE \'\\\'');
    expect(postgres.sql).toContain('"title"');
  });

  it("should neutralize LIKE wildcards in the search term", () => {
    const { params } = buildListTemplatesQuery(
      { q: "50%_off" },
      "sqlite",
    );
    expect(params).toEqual(["%50\\%\\_off%", "%50\\%\\_off%"]);
  });

  it("should restrict to visible projects for non-admin viewers", () => {
    const { sql, params } = buildListTemplatesQuery(
      { visibleTo: { userId: "u1" } },
      "sqlite",
    );
    expect(sql).toContain(
      "(projectId IN (SELECT id FROM projects WHERE visibility = 'public') OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?))",
    );
    expect(params).toEqual(["u1"]);
  });

  it("should combine filters with AND in a stable param order", () => {
    const { sql, params } = buildListTemplatesQuery(
      { projectId: "p1", q: "report", visibleTo: { userId: "u1" } },
      "sqlite",
    );
    expect(sql).toContain(" WHERE ");
    expect((sql.match(/ AND /g) || []).length).toBe(2);
    expect(params).toEqual(["p1", "u1", "%report%", "%report%"]);
  });

  it("should ignore an empty projectIds list", () => {
    const { sql, params } = buildListTemplatesQuery(
      { projectIds: [] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM task_templates ORDER BY dateCreated DESC",
    );
    expect(params).toEqual([]);
  });
});
