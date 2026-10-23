import * as fs from "fs-extra";
import * as path from "path";
import axios from "axios";

// Mock dependencies
jest.mock("fs-extra");
jest.mock("axios");
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));
jest.mock("../utils/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
  DbUtilsQuerySQL: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPathExists = (fs as any).pathExists as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockEnsureDir = (fs as any).ensureDir as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWriteJson = (fs as any).writeJson as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReadJson = (fs as any).readJson as jest.Mock;
const mockAxios = axios as jest.Mocked<typeof axios>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
const mockDbUtils = require("../utils/DbUtils") as any;

import {
  RecommendationInit,
  RecommendationGetCached,
  RecommendationGenerateAll,
  RecommendationGenerateForUser,
} from "./Recommendation";
import { Config } from "../Config";

describe("Recommendation", () => {
  let config: Config;

  beforeEach(() => {
    jest.clearAllMocks();

    config = new Config();
    config.DATA_DIR = "/tmp/test-data";
    config.LLM_API_KEY = "test-key";
    config.LLM_API_URL = "https://api.test.com/chat";
    config.LLM_MODEL = "test-model";
    config.LLM_RECOMMENDATION_ENABLED = true;
    config.LLM_RECOMMENDATION_SCHEDULE_CRON = "0 0 * * *";

    mockPathExists.mockResolvedValue(false);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteJson.mockResolvedValue(undefined);
  });

  describe("RecommendationInit", () => {
    it("should initialize without errors", async () => {
      await expect(RecommendationInit(config)).resolves.toBeUndefined();
    });

    it("should schedule cron job when feature is enabled and API key is set", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cron = require("node-cron");
      await RecommendationInit(config);
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 0 * * *",
        expect.any(Function),
      );
    });

    it("should not schedule cron job when feature is disabled", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cron = require("node-cron");
      config.LLM_RECOMMENDATION_ENABLED = false;
      await RecommendationInit(config);
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("should not schedule cron job when API key is empty", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cron = require("node-cron");
      config.LLM_API_KEY = "";
      await RecommendationInit(config);
      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  describe("RecommendationGetCached", () => {
    it("should return null when no cached file exists", async () => {
      mockPathExists.mockResolvedValue(false);
      const result = await RecommendationGetCached("user-1");
      expect(result).toBeNull();
    });

    it("should return cached data when file exists", async () => {
      const cachedData = {
        generatedAt: "2026-01-01T00:00:00.000Z",
        analysis: "Test analysis",
        recommendations: "Test recommendations",
        tasks: [],
      };
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue(cachedData);

      const result = await RecommendationGetCached("user-1");
      expect(result).toEqual(cachedData);
      expect(mockReadJson).toHaveBeenCalledWith(
        path.join("/tmp/test-data", "recommendation-user-1.json"),
      );
    });

    it("should return null when reading cached file fails", async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error("read error"));

      const result = await RecommendationGetCached("user-1");
      expect(result).toBeNull();
    });
  });

  describe("RecommendationGenerateForUser", () => {
    const mockUserTasks = [
      {
        id: "task-1",
        title: "Fix bug",
        status: "In Progress",
        priority: "high",
        dueDate: "2026-01-10",
        projectId: "proj-1",
        dateCreated: "2026-01-01T00:00:00.000Z",
        dateUpdated: "2026-01-05T00:00:00.000Z",
      },
    ];

    const mockDoneTasks = [
      {
        id: "task-done-1",
        title: "Completed task",
        status: "Done",
        priority: "medium",
        dueDate: null,
        projectId: "proj-1",
        dateCreated: "2026-01-01T00:00:00.000Z",
        dateUpdated: "2026-01-03T00:00:00.000Z",
      },
    ];

    const mockUser = [{ id: "user-1", name: "Alice" }];
    const mockLabels = [{ name: "bug" }];

    beforeEach(() => {
      // Default mock for DbUtilsQuerySQL (multi-user mode by default)
      mockDbUtils.DbUtilsQuerySQL.mockImplementation((sql: string) => {
        if (sql.includes("FROM users WHERE id"))
          return Promise.resolve(mockUser);
        if (sql.includes("COUNT(*)")) return Promise.resolve([{ count: 2 }]);
        if (sql.includes("FROM users")) return Promise.resolve(mockUser);
        if (sql.includes("task_assignees") && sql.includes("!= 'Done'"))
          return Promise.resolve(mockUserTasks);
        if (sql.includes("task_assignees") && sql.includes("= 'Done'"))
          return Promise.resolve(mockDoneTasks);
        if (sql.includes("NOT IN")) return Promise.resolve([]);
        if (sql.includes("task_labels")) return Promise.resolve(mockLabels);
        return Promise.resolve([]);
      });
    });

    it("should generate and cache a recommendation", async () => {
      const llmResponse = {
        data: {
          choices: [
            {
              message: {
                content:
                  "## Analysis\nYour workload looks manageable.\n\n## Recommendations\n- Focus on task-1 first",
              },
            },
          ],
        },
      };
      mockAxios.post.mockResolvedValue(llmResponse);

      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      expect(mockAxios.post).toHaveBeenCalledWith(
        "https://api.test.com/chat",
        expect.objectContaining({
          model: "test-model",
          messages: expect.any(Array),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        }),
      );

      expect(mockWriteJson).toHaveBeenCalledWith(
        path.join("/tmp/test-data", "recommendation-user-1.json"),
        expect.objectContaining({
          generatedAt: expect.any(String),
          analysis: "Your workload looks manageable.",
          recommendations: "- Focus on task-1 first",
          tasks: expect.any(Array),
        }),
      );
    });

    it("should handle LLM returning empty response", async () => {
      const llmResponse = {
        data: {
          choices: [{ message: { content: "" } }],
        },
      };
      mockAxios.post.mockResolvedValue(llmResponse);

      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      expect(mockWriteJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          analysis: expect.stringContaining("empty response"),
        }),
      );
    });

    it("should handle LLM API failure gracefully", async () => {
      mockAxios.post.mockRejectedValue(new Error("API unavailable"));

      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      expect(mockWriteJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          analysis: expect.stringContaining("failed"),
        }),
      );
    });

    it("should include task data in cached output", async () => {
      const llmResponse = {
        data: {
          choices: [
            {
              message: {
                content:
                  "## Analysis\nGood progress.\n\n## Recommendations\nKeep going.",
              },
            },
          ],
        },
      };
      mockAxios.post.mockResolvedValue(llmResponse);

      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      const writeCall = mockWriteJson.mock.calls[0];
      const result = writeCall[1] as {
        tasks: { id: string; title: string }[];
      };
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it("should ignore task assignment when only 1 user exists (single-user mode)", async () => {
      const allTasks = [
        {
          id: "task-1",
          title: "Fix bug",
          status: "In Progress",
          priority: "high",
          dueDate: "2026-01-10",
          projectId: "proj-1",
          dateCreated: "2026-01-01T00:00:00.000Z",
          dateUpdated: "2026-01-05T00:00:00.000Z",
        },
        {
          id: "task-2",
          title: "Unassigned task",
          status: "To Do",
          priority: "low",
          dueDate: null,
          projectId: "proj-1",
          dateCreated: "2026-01-02T00:00:00.000Z",
          dateUpdated: "2026-01-02T00:00:00.000Z",
        },
      ];

      // Override mock to simulate single user + all-tasks queries
      mockDbUtils.DbUtilsQuerySQL.mockImplementation((sql: string) => {
        if (sql.includes("FROM users WHERE id"))
          return Promise.resolve(mockUser);
        if (sql.includes("COUNT(*)")) return Promise.resolve([{ count: 1 }]);
        if (sql.includes("FROM users")) return Promise.resolve(mockUser);
        // Single-user mode uses ALL_TASKS queries (no task_assignees join)
        if (
          sql.includes("FROM tasks t WHERE") &&
          !sql.includes("task_assignees") &&
          sql.includes("!= 'Done'")
        )
          return Promise.resolve(allTasks);
        if (
          sql.includes("FROM tasks t WHERE") &&
          !sql.includes("task_assignees") &&
          sql.includes("= 'Done'")
        )
          return Promise.resolve(mockDoneTasks);
        if (sql.includes("task_labels")) return Promise.resolve(mockLabels);
        return Promise.resolve([]);
      });

      const llmResponse = {
        data: {
          choices: [
            {
              message: {
                content:
                  "## Analysis\nYou have 2 open tasks.\n\n## Recommendations\n- Prioritize task-1",
              },
            },
          ],
        },
      };
      mockAxios.post.mockResolvedValue(llmResponse);

      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      // Verify the prompt sent to LLM includes both tasks (not just assigned ones)
      const postCall = mockAxios.post.mock.calls[0];
      const body = postCall[1] as {
        messages: { role: string; content: string }[];
      };
      const messages = body.messages;
      const userMessage = messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("task-1");
      expect(userMessage.content).toContain("task-2");
      // Should show "Total open tasks" not "Total assigned tasks"
      expect(userMessage.content).toContain("Total open tasks: 2");
      expect(userMessage.content).not.toContain("unassigned");
    });
  });

  describe("project visibility filtering", () => {
    interface QueryCall {
      sql: string;
      params: unknown[];
    }
    const captures: QueryCall[] = [];

    function mockUserQueries(role: string, userCount: number): void {
      mockDbUtils.DbUtilsQuerySQL.mockImplementation(
        (sql: string, params: unknown[] = []) => {
          captures.push({ sql, params });
          if (sql.includes("FROM users WHERE id"))
            return Promise.resolve([{ id: "user-1", name: "Alice", role }]);
          if (sql.includes("COUNT(*)"))
            return Promise.resolve([{ count: userCount }]);
          return Promise.resolve([]);
        },
      );
      mockAxios.post.mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: "## Analysis\nok\n\n## Recommendations\nok",
              },
            },
          ],
        },
      });
    }

    beforeEach(() => {
      captures.length = 0;
    });

    it("should filter assigned-task stats through project visibility for non-admins", async () => {
      mockUserQueries("user", 2);
      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      const taskCalls = captures.filter((call) =>
        call.sql.includes("task_assignees"),
      );
      expect(taskCalls).toHaveLength(2);
      for (const call of taskCalls) {
        expect(call.sql).toContain(
          "IN (SELECT id FROM projects WHERE visibility = 'public')",
        );
        expect(call.params).toEqual(["user-1", "user-1"]);
      }
    });

    it("should not filter assigned-task stats for admins", async () => {
      mockUserQueries("admin", 2);
      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      const taskCalls = captures.filter((call) =>
        call.sql.includes("task_assignees"),
      );
      expect(taskCalls).toHaveLength(2);
      for (const call of taskCalls) {
        expect(call.sql).not.toContain("visibility = 'public'");
        expect(call.params).toEqual(["user-1"]);
      }
    });

    it("should filter all-task stats in single-user mode for non-admins", async () => {
      mockUserQueries("user", 1);
      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      const allTaskCalls = captures.filter(
        (call) =>
          call.sql.includes("FROM tasks t WHERE") &&
          !call.sql.includes("task_assignees"),
      );
      expect(allTaskCalls).toHaveLength(2);
      for (const call of allTaskCalls) {
        expect(call.sql).toContain("visibility = 'public'");
        expect(call.params).toEqual(["user-1"]);
      }
    });

    it("should not filter all-task stats in single-user mode for admins", async () => {
      mockUserQueries("admin", 1);
      await RecommendationInit(config);
      await RecommendationGenerateForUser("user-1");

      const allTaskCalls = captures.filter(
        (call) =>
          call.sql.includes("FROM tasks t WHERE") &&
          !call.sql.includes("task_assignees"),
      );
      expect(allTaskCalls).toHaveLength(2);
      for (const call of allTaskCalls) {
        expect(call.sql).not.toContain("visibility = 'public'");
        expect(call.params).toEqual([]);
      }
    });
  });

  describe("RecommendationGenerateAll overlap guard", () => {
    function deferred<T = unknown>() {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    async function flush(times = 5): Promise<void> {
      for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    it("should not start a second run while one is in flight", async () => {
      const userList = deferred<unknown[]>();
      let userListCalls = 0;
      mockDbUtils.DbUtilsQuerySQL.mockImplementation((sql: string) => {
        if (sql.includes("FROM users")) {
          userListCalls++;
          return userList.promise;
        }
        return Promise.resolve([]);
      });

      const run1 = RecommendationGenerateAll();
      await flush();
      expect(userListCalls).toBe(1);

      await RecommendationGenerateAll();
      expect(userListCalls).toBe(1);

      userList.resolve([]);
      await run1;

      await RecommendationGenerateAll();
      expect(userListCalls).toBe(2);
    });

    it("should call the LLM once for two concurrent runs", async () => {
      const llm = deferred();
      mockDbUtils.DbUtilsQuerySQL.mockImplementation((sql: string) => {
        if (sql.includes("FROM users WHERE id"))
          return Promise.resolve([{ id: "user-1", name: "Alice", role: "admin" }]);
        if (sql.includes("COUNT(*)")) return Promise.resolve([{ count: 2 }]);
        if (sql.includes("FROM users"))
          return Promise.resolve([{ id: "user-1", name: "Alice" }]);
        return Promise.resolve([]);
      });
      mockAxios.post.mockReturnValue(llm.promise);

      const run1 = RecommendationGenerateAll();
      await flush();
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      await RecommendationGenerateAll();
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      llm.resolve({
        data: {
          choices: [
            {
              message: {
                content: "## Analysis\nok\n\n## Recommendations\nok",
              },
            },
          ],
        },
      });
      await run1;

      mockAxios.post.mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: "## Analysis\nok\n\n## Recommendations\nok",
              },
            },
          ],
        },
      });
      await RecommendationGenerateAll();
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it("should reset the guard when the user-list query rejects", async () => {
      let userListCalls = 0;
      mockDbUtils.DbUtilsQuerySQL.mockImplementation((sql: string) => {
        if (sql.includes("FROM users")) {
          userListCalls++;
          return userListCalls === 1
            ? Promise.reject(new Error("db down"))
            : Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      await expect(RecommendationGenerateAll()).rejects.toThrow("db down");
      await expect(RecommendationGenerateAll()).resolves.toBeUndefined();
      expect(userListCalls).toBe(2);
    });
  });
});
