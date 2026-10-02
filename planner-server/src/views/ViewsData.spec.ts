import { DbUtilsQuerySQL } from "../utils/DbUtils";
import { DASHBOARD_SECTION_LIMIT, ViewsDataGetDashboard } from "./ViewsData";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsExecSQL: jest.fn(async () => undefined),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

const mockQuery = DbUtilsQuerySQL as jest.Mock;

function taskRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "proj-1",
    title: `Task ${id}`,
    status: "To Do",
    priority: "medium",
    dueDate: null,
    ...overrides,
  };
}

describe("ViewsDataGetDashboard visibility", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it("should add the visibility condition to every section for non-admin viewers", async () => {
    await ViewsDataGetDashboard({ visibleTo: { userId: "user-1" } });
    const calls = mockQuery.mock.calls;
    expect(calls.length).toBe(4);
    for (const [sql, params] of calls) {
      expect(sql).toContain(
        "projectId IN (SELECT id FROM projects WHERE visibility = 'public')",
      );
      expect(sql).toContain(
        "projectId IN (SELECT projectId FROM project_users WHERE userId = ?)",
      );
      expect(params).toContain("user-1");
    }
  });

  it("should not add the visibility clause without visibleTo (admin)", async () => {
    await ViewsDataGetDashboard({});
    for (const [sql] of mockQuery.mock.calls) {
      expect(sql).not.toContain("project_users");
    }
  });

  it("should combine the visibility clause with the project filter", async () => {
    await ViewsDataGetDashboard({
      projectId: "proj-1",
      visibleTo: { userId: "user-1" },
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("projectId = ?");
    expect(sql).toContain("project_users");
    expect(params).toContain("proj-1");
    expect(params.indexOf("proj-1")).toBeLessThan(params.indexOf("user-1"));
  });
});

describe("ViewsDataGetDashboard projectIds (subtree)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it("should add the IN clause to every section query with params in order", async () => {
    await ViewsDataGetDashboard({ projectIds: ["proj-1", "proj-2"] });
    const calls = mockQuery.mock.calls;
    expect(calls.length).toBe(4);
    for (const [sql, params] of calls) {
      expect(sql).toContain("projectId IN (?, ?)");
      expect(params).toContain("proj-1");
      expect(params).toContain("proj-2");
    }
  });

  it("should combine projectIds with the visibility clause", async () => {
    await ViewsDataGetDashboard({
      projectIds: ["proj-1"],
      visibleTo: { userId: "user-1" },
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("projectId IN (?)");
    expect(sql).toContain("project_users");
    expect(params.indexOf("proj-1")).toBeLessThan(params.indexOf("user-1"));
  });

  it("should ignore an empty projectIds array", async () => {
    await ViewsDataGetDashboard({ projectIds: [] });
    for (const [sql] of mockQuery.mock.calls) {
      expect(sql).not.toContain("projectId IN");
    }
  });
});

describe("ViewsDataGetDashboard sections", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it("should cap the overdue, upcoming and no-date sections", async () => {
    await ViewsDataGetDashboard({});
    const overdueSql = mockQuery.mock.calls[0][0] as string;
    const upcomingSql = mockQuery.mock.calls[1][0] as string;
    const noDateSql = mockQuery.mock.calls[2][0] as string;
    expect(overdueSql).toContain(`LIMIT ${DASHBOARD_SECTION_LIMIT}`);
    expect(upcomingSql).toContain(`LIMIT ${DASHBOARD_SECTION_LIMIT}`);
    expect(noDateSql).toContain(`LIMIT ${DASHBOARD_SECTION_LIMIT}`);
  });

  it("should limit recently-done to the 5 most recently updated (spec)", async () => {
    await ViewsDataGetDashboard({});
    const doneSql = mockQuery.mock.calls[3][0] as string;
    expect(doneSql).toContain("ORDER BY dateUpdated DESC");
    expect(doneSql).toContain("LIMIT 5");
  });

  it("should keep only done tasks updated in the last 30 days", async () => {
    const before = Date.now();
    await ViewsDataGetDashboard({});
    const [doneSql, doneParams] = mockQuery.mock.calls[3];
    expect(doneSql).toContain("status = ? AND dateUpdated >= ?");
    expect(doneParams[0]).toBe("Done");
    const cutoffMs = new Date(doneParams[1] as string).getTime();
    const expectedCutoff = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedCutoff)).toBeLessThan(5 * 1000);
  });

  it("should fetch all section labels with one batched query", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM task_labels")) {
        return [
          { taskId: "t1", name: "bug" },
          { taskId: "t1", name: "ui" },
          { taskId: "t2", name: "idea" },
        ];
      }
      if (sql.includes("dueDate IS NOT NULL AND dueDate <")) {
        return [taskRow("t1")];
      }
      if (sql.includes("dateUpdated >=")) {
        return [taskRow("t2", { status: "Done" })];
      }
      return [];
    });

    const data = await ViewsDataGetDashboard({});

    // 4 section queries + 1 labels query for every row of every section
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [labelsSql, labelsParams] = mockQuery.mock.calls[4];
    expect(labelsSql).toContain("FROM task_labels");
    expect(labelsSql).toContain("taskId IN (?, ?)");
    expect(labelsParams).toEqual(["t1", "t2"]);

    expect(data.overdue).toHaveLength(1);
    expect(data.overdue[0].labels).toEqual(["bug", "ui"]);
    expect(data.recentlyDone).toHaveLength(1);
    expect(data.recentlyDone[0].labels).toEqual(["idea"]);
    expect(data.upcoming).toEqual([]);
    expect(data.noDate).toEqual([]);
  });

  it("should skip the labels query when no section has rows", async () => {
    const data = await ViewsDataGetDashboard({});
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(data).toEqual({
      overdue: [],
      upcoming: [],
      noDate: [],
      recentlyDone: [],
    });
  });

  it("should return empty labels for tasks without labels", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM task_labels")) {
        return [];
      }
      if (sql.includes("dueDate IS NOT NULL AND dueDate <")) {
        return [taskRow("t1")];
      }
      return [];
    });
    const data = await ViewsDataGetDashboard({});
    expect(data.overdue[0].labels).toEqual([]);
  });
});
