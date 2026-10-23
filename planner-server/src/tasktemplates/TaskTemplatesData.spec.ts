import {
  TaskTemplatesAdd,
  TaskTemplatesList,
  TaskTemplatesUpdate,
  buildListTemplatesQuery,
} from "./TaskTemplatesData";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils/DbUtils";
import { TaskTemplate } from "../model/TaskTemplate";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsExecSQL: jest.fn(),
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsGetType: jest.fn(() => "sqlite"),
  DbUtilsTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
}));

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

describe("TaskTemplatesAdd / TaskTemplatesUpdate instanceStatus persistence", () => {
  function makeTemplate(): TaskTemplate {
    const template = new TaskTemplate();
    template.projectId = "p1";
    template.title = "Weekly report";
    return template;
  }

  beforeEach(() => {
    (DbUtilsExecSQL as jest.Mock).mockClear();
  });

  it("should insert the instanceStatus column when set", async () => {
    const template = makeTemplate();
    template.instanceStatus = "Doing";
    await TaskTemplatesAdd(template);
    const [sql, params] = (DbUtilsExecSQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("instanceStatus");
    expect(params).toContain("Doing");
  });

  it("should insert null when the instanceStatus is not set", async () => {
    const template = makeTemplate();
    await TaskTemplatesAdd(template);
    const [sql, params] = (DbUtilsExecSQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("instanceStatus");
    expect(params).toContain(null);
  });

  it("should update the instanceStatus column when set", async () => {
    const template = makeTemplate();
    template.instanceStatus = "Review";
    await TaskTemplatesUpdate(template);
    const [sql, params] = (DbUtilsExecSQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("instanceStatus");
    expect(params).toContain("Review");
  });

  it("should update to null when the instanceStatus is cleared", async () => {
    const template = makeTemplate();
    await TaskTemplatesUpdate(template);
    const [sql, params] = (DbUtilsExecSQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("instanceStatus");
    expect(params).toContain(null);
  });
});

describe("buildListTemplatesQuery pagination", () => {
  it("should append LIMIT and OFFSET with params in order (sqlite)", () => {
    const { sql, params } = buildListTemplatesQuery(
      { projectId: "p1", limit: 20, offset: 40 },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM task_templates WHERE projectId = ? ORDER BY dateCreated DESC LIMIT ? OFFSET ?",
    );
    expect(params).toEqual(["p1", 20, 40]);
  });

  it("should append only LIMIT when the offset is zero", () => {
    const { sql, params } = buildListTemplatesQuery(
      { limit: 1000, offset: 0 },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM task_templates ORDER BY dateCreated DESC LIMIT ?",
    );
    expect(params).toEqual([1000]);
  });

  it("should quote identifiers and keep placeholders (postgres)", () => {
    const { sql, params } = buildListTemplatesQuery(
      { limit: 20, offset: 40 },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM task_templates ORDER BY "dateCreated" DESC LIMIT ? OFFSET ?',
    );
    expect(params).toEqual([20, 40]);
  });

  it("should keep the internal listing unbounded without a limit", async () => {
    (DbUtilsQuerySQL as jest.Mock).mockClear();
    await TaskTemplatesList();
    expect(DbUtilsQuerySQL).toHaveBeenCalledWith(
      "SELECT * FROM task_templates ORDER BY dateCreated DESC",
      [],
    );
  });
});
