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
});
