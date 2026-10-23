import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import axios from "axios";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { Config } from "../Config";
import { UserSession } from "../model/UserSession";
import { addComment, getComment } from "../tasks/TasksData";
import { addNoteComment, getNoteComment } from "../notes/NotesData";
import {
  addTemplateComment,
  getTemplateComment,
} from "../tasktemplates/TaskTemplatesData";
import {
  isProjectItemVisible,
  visibleProjectsCondition,
} from "../projects/ProjectVisibility";
import {
  RecommendationGenerateForUser,
  RecommendationGetCached,
  RecommendationInit,
} from "../recommendation/Recommendation";

/**
 * Real-database proof of the authorization/visibility hardening:
 * comment parent binding (H1), fail-closed project visibility agreed by
 * direct reads and list predicates (M2) and recommendation title filtering
 * for restricted projects (H2).
 */

jest.mock("axios");
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

const mockAxios = axios as jest.Mocked<typeof axios>;

const dir = path.join(
  os.tmpdir(),
  `planner-authorization-visibility-${Date.now()}`,
);
const now = new Date().toISOString();
let recommendationConfig: Config;

function userSession(
  userId: string,
  role: "user" | "admin" = "user",
): UserSession {
  return {
    isAuthenticated: true,
    userId,
    userName: `user-${userId}`,
    role,
  };
}

async function insertUser(id: string, role = "user"): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
    [id, `user-${id}`, "x", role, now],
  );
}

async function insertProject(
  id: string,
  visibility = "public",
  archived = 0,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility, archived) VALUES (?,?,?,?,?,?,?,?)",
    [id, `project-${id}`, "", 0, '["To Do", "Done"]', now, visibility, archived],
  );
}

async function insertProjectUser(
  projectId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
    [projectId, userId],
  );
}

async function insertTask(
  id: string,
  projectId: string,
  title = `task-${id}`,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, title, "", "To Do", "medium", "[]", now, now],
  );
}

async function insertNote(id: string, projectId: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?)",
    [id, projectId, `note-${id}`, "", now, now],
  );
}

async function insertTemplate(id: string, projectId: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO task_templates (id, projectId, title, description, priority, checklist, scheduleCron, skipIfPreviousNotDone, addDateToTitle, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, projectId, `template-${id}`, "", "medium", "[]", null, 0, 0, now, now],
  );
}

async function insertAssignee(taskId: string, userId: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
    [taskId, userId],
  );
}

async function visibleRowIds(
  condition: { sql: string; params: unknown[] },
  table: "tasks" | "notes" | "task_templates",
): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT id FROM ${table} WHERE ${condition.sql}`,
    condition.params,
  );
  return rows.map((row) => row.id as string);
}

async function visibleProjectIds(userId: string): Promise<string[]> {
  const condition = visibleProjectsCondition(userId, "sqlite");
  const rows = await DbUtilsQuerySQL(
    `SELECT id AS "projectId" FROM projects WHERE ${condition.sql}`,
    condition.params,
  );
  return rows.map((row) => row.projectId as string);
}

function userPromptOf(
  userId: string,
): string {
  const call = mockAxios.post.mock.calls.find(
    (candidate) =>
      ((candidate[1] as { messages: { role: string; content: string }[] })
        ?.messages ?? []).some(
        (message) =>
          message.role === "user" && message.content.includes(`user-${userId}`),
      ),
  );
  if (!call) {
    return "";
  }
  const messages = (call[1] as { messages: { role: string; content: string }[] })
    .messages;
  return messages.find((message) => message.role === "user")?.content ?? "";
}

describe("authorization and visibility hardening (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    recommendationConfig = new Config();
    recommendationConfig.DATA_DIR = dir;
    recommendationConfig.LLM_API_KEY = "test-key";
    recommendationConfig.LLM_API_URL = "https://api.test.com/chat";
    recommendationConfig.LLM_MODEL = "test-model";
    recommendationConfig.LLM_RECOMMENDATION_ENABLED = true;
    await RecommendationInit(recommendationConfig);
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  beforeEach(() => {
    mockAxios.post.mockReset();
    mockAxios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "## Analysis\nAll good.\n\n## Recommendations\nKeep going.",
            },
          },
        ],
      },
    });
  });

  describe("H1 — comments are bound to their parent", () => {
    it("should only load a task comment through its own task", async () => {
      await insertUser("u-h1");
      await insertProject("p-h1");
      await insertTask("t-h1-a", "p-h1");
      await insertTask("t-h1-b", "p-h1");
      await addComment("t-h1-a", {
        id: "c-h1",
        userId: "u-h1",
        text: "on A",
        dateCreated: now,
      });

      expect(await getComment("c-h1", "t-h1-a")).toMatchObject({
        id: "c-h1",
        text: "on A",
      });
      expect(await getComment("c-h1", "t-h1-b")).toBeNull();
    });

    it("should not load an archived-project comment through a writable task", async () => {
      await insertUser("u-h1-arch");
      await insertProject("p-h1-arch", "public", 1);
      await insertProject("p-h1-active");
      await insertTask("t-h1-arch", "p-h1-arch");
      await insertTask("t-h1-active", "p-h1-active");
      await addComment("t-h1-arch", {
        id: "c-h1-arch",
        userId: "u-h1-arch",
        text: "frozen",
        dateCreated: now,
      });

      expect(await getComment("c-h1-arch", "t-h1-arch")).not.toBeNull();
      expect(await getComment("c-h1-arch", "t-h1-active")).toBeNull();
    });

    it("should only load a note comment through its own note", async () => {
      await insertUser("u-h1-note");
      await insertProject("p-h1-note");
      await insertNote("n-h1-a", "p-h1-note");
      await insertNote("n-h1-b", "p-h1-note");
      await addNoteComment("n-h1-a", {
        id: "nc-h1",
        userId: "u-h1-note",
        text: "on A",
        dateCreated: now,
      });

      expect(await getNoteComment("nc-h1", "n-h1-a")).toMatchObject({
        id: "nc-h1",
        text: "on A",
      });
      expect(await getNoteComment("nc-h1", "n-h1-b")).toBeNull();
    });

    it("should only load a template comment through its own template", async () => {
      await insertUser("u-h1-template");
      await insertProject("p-h1-template");
      await insertTemplate("tt-h1-a", "p-h1-template");
      await insertTemplate("tt-h1-b", "p-h1-template");
      await addTemplateComment("tt-h1-a", {
        id: "tc-h1",
        userId: "u-h1-template",
        text: "on A",
        dateCreated: now,
      });

      expect(await getTemplateComment("tc-h1", "tt-h1-a")).toMatchObject({
        id: "tc-h1",
        text: "on A",
      });
      expect(await getTemplateComment("tc-h1", "tt-h1-b")).toBeNull();
    });
  });

  describe("M2 — unknown visibility fails closed everywhere", () => {
    it("should hide an unknown-visibility project from lists and direct reads for non-members", async () => {
      await insertUser("u-m2-nonmember");
      await insertUser("u-m2-member");
      await insertUser("u-m2-admin", "admin");
      await insertProject("p-m2-unknown", "privat");
      await insertProjectUser("p-m2-unknown", "u-m2-member");
      await insertTask("t-m2", "p-m2-unknown");
      await insertNote("n-m2", "p-m2-unknown");
      await insertTemplate("tt-m2", "p-m2-unknown");

      const nonMember = userSession("u-m2-nonmember");
      const condition = visibleProjectsCondition("u-m2-nonmember", "sqlite");

      expect(await visibleProjectIds("u-m2-nonmember")).not.toContain(
        "p-m2-unknown",
      );
      expect(await visibleRowIds(condition, "tasks")).not.toContain("t-m2");
      expect(await visibleRowIds(condition, "notes")).not.toContain("n-m2");
      expect(await visibleRowIds(condition, "task_templates")).not.toContain(
        "tt-m2",
      );
      expect(
        await isProjectItemVisible({ projectId: "p-m2-unknown" }, nonMember),
      ).toBe(false);
    });

    it("should show an unknown-visibility project to its members and admins", async () => {
      const memberCondition = visibleProjectsCondition("u-m2-member", "sqlite");
      expect(await visibleProjectIds("u-m2-member")).toContain("p-m2-unknown");
      expect(await visibleRowIds(memberCondition, "tasks")).toContain("t-m2");
      expect(await visibleRowIds(memberCondition, "notes")).toContain("n-m2");
      expect(await visibleRowIds(memberCondition, "task_templates")).toContain(
        "tt-m2",
      );
      expect(
        await isProjectItemVisible(
          { projectId: "p-m2-unknown" },
          userSession("u-m2-member"),
        ),
      ).toBe(true);
      expect(
        await isProjectItemVisible(
          { projectId: "p-m2-unknown" },
          userSession("u-m2-admin", "admin"),
        ),
      ).toBe(true);
    });
  });

  describe("H2 — recommendations never quote inaccessible titles", () => {
    it("should only use public-project titles for a non-admin and all titles for an admin", async () => {
      await insertUser("u-rec-user");
      await insertUser("u-rec-admin", "admin");
      await insertProject("p-rec-public");
      await insertProject("p-rec-secret", "restricted");
      await insertTask("t-rec-public", "p-rec-public", "Public task title");
      await insertTask("t-rec-secret", "p-rec-secret", "Secret task title");
      for (const userId of ["u-rec-user", "u-rec-admin"]) {
        await insertAssignee("t-rec-public", userId);
        await insertAssignee("t-rec-secret", userId);
      }

      await RecommendationGenerateForUser("u-rec-user");

      const userCached = await RecommendationGetCached("u-rec-user");
      expect(userCached).not.toBeNull();
      expect(userCached!.tasks.map((task) => task.title)).toEqual([
        "Public task title",
      ]);
      const userPrompt = userPromptOf("u-rec-user");
      expect(userPrompt).toContain("Public task title");
      expect(userPrompt).not.toContain("Secret task title");

      await RecommendationGenerateForUser("u-rec-admin");

      const adminCached = await RecommendationGetCached("u-rec-admin");
      expect(adminCached).not.toBeNull();
      expect(adminCached!.tasks.map((task) => task.title).sort()).toEqual([
        "Public task title",
        "Secret task title",
      ]);
      const adminPrompt = userPromptOf("u-rec-admin");
      expect(adminPrompt).toContain("Public task title");
      expect(adminPrompt).toContain("Secret task title");
    });
  });
});
