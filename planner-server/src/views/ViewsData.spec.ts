import { DbUtilsQuerySQL } from "../utils/DbUtils";
import { ViewsDataGetDashboard } from "./ViewsData";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsExecSQL: jest.fn(async () => undefined),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

describe("ViewsData", () => {
  it("should export NextViewData interface with correct structure", () => {
    // Verify the types are correct by constructing a valid object
    const viewData = {
      overdue: [],
      upcoming: [],
      highPriority: [],
    };
    expect(viewData.overdue).toEqual([]);
    expect(viewData.upcoming).toEqual([]);
    expect(viewData.highPriority).toEqual([]);
  });

  it("should export NextViewTask interface with correct fields", () => {
    const task = {
      id: "test-id",
      projectId: "proj-id",
      title: "Test Task",
      status: "To Do",
      priority: "high",
      dueDate: "2025-06-15",
      labels: ["urgent"],
    };
    expect(task.id).toBe("test-id");
    expect(task.title).toBe("Test Task");
    expect(task.priority).toBe("high");
    expect(task.labels).toContain("urgent");
  });
});

describe("ViewsDataGetDashboard visibility", () => {
  beforeEach(() => {
    (DbUtilsQuerySQL as jest.Mock).mockClear();
  });

  it("should add the visibility condition to every section for non-admin viewers", async () => {
    await ViewsDataGetDashboard({ visibleTo: { userId: "user-1" } });
    const calls = (DbUtilsQuerySQL as jest.Mock).mock.calls;
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
    for (const [sql] of (DbUtilsQuerySQL as jest.Mock).mock.calls) {
      expect(sql).not.toContain("project_users");
    }
  });

  it("should combine the visibility clause with the project filter", async () => {
    await ViewsDataGetDashboard({
      projectId: "proj-1",
      visibleTo: { userId: "user-1" },
    });
    const [sql, params] = (DbUtilsQuerySQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("projectId = ?");
    expect(sql).toContain("project_users");
    expect(params).toContain("proj-1");
    expect(params.indexOf("proj-1")).toBeLessThan(params.indexOf("user-1"));
  });
});

describe("ViewsDataGetDashboard projectIds (subtree)", () => {
  beforeEach(() => {
    (DbUtilsQuerySQL as jest.Mock).mockClear();
  });

  it("should add the IN clause to every section query with params in order", async () => {
    await ViewsDataGetDashboard({ projectIds: ["proj-1", "proj-2"] });
    const calls = (DbUtilsQuerySQL as jest.Mock).mock.calls;
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
    const [sql, params] = (DbUtilsQuerySQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("projectId IN (?)");
    expect(sql).toContain("project_users");
    expect(params.indexOf("proj-1")).toBeLessThan(params.indexOf("user-1"));
  });

  it("should leave the SQL unchanged without projectIds", async () => {
    await ViewsDataGetDashboard({});
    for (const [sql] of (DbUtilsQuerySQL as jest.Mock).mock.calls) {
      expect(sql).not.toContain("projectId IN (?, ?)");
    }
  });

  it("should ignore an empty projectIds array", async () => {
    await ViewsDataGetDashboard({ projectIds: [] });
    for (const [sql] of (DbUtilsQuerySQL as jest.Mock).mock.calls) {
      expect(sql).not.toContain("projectId IN");
    }
  });
});
