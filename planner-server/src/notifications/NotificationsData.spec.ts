import { DbUtilsQuerySQL } from "../utils/DbUtils";
import { NotificationsDataListVisibleProjectIdsForUsers } from "./NotificationsData";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsExecSQL: jest.fn(async () => undefined),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

const mockQuery = DbUtilsQuerySQL as jest.Mock;

describe("NotificationsDataListVisibleProjectIdsForUsers", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it("should not query when no user is requested", async () => {
    const result = await NotificationsDataListVisibleProjectIdsForUsers([]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("should resolve public and membership projects in one query", async () => {
    mockQuery.mockResolvedValue([
      // Public projects come back once with a NULL userId
      { projectId: "p-public", userId: null },
      { projectId: "p-a", userId: "user-a" },
      { projectId: "p-b", userId: "user-b" },
    ]);

    const result = await NotificationsDataListVisibleProjectIdsForUsers([
      "user-a",
      "user-b",
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("visibility = 'public'");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("userId IN (?, ?)");
    expect(params).toEqual(["user-a", "user-b"]);

    // Public projects are visible to every requested user
    expect(result.get("user-a")).toEqual(new Set(["p-public", "p-a"]));
    expect(result.get("user-b")).toEqual(new Set(["p-public", "p-b"]));
  });

  it("should ignore memberships of users that were not requested", async () => {
    mockQuery.mockResolvedValue([
      { projectId: "p-other", userId: "user-other" },
    ]);

    const result = await NotificationsDataListVisibleProjectIdsForUsers([
      "user-a",
    ]);

    expect(result.get("user-a")).toEqual(new Set());
  });
});
