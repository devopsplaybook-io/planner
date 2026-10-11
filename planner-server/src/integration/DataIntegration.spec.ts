import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQueryCountGet,
  DbUtilsQueryCountReset,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { Config } from "../Config";
import { NotesDataDelete, NotesDataList } from "../notes/NotesData";
import { ProjectsDataDelete } from "../projects/ProjectsData";
import {
  TasksDataDelete,
  TasksDataGet,
  TasksDataList,
  replaceDependencies,
} from "../tasks/TasksData";
import {
  TaskActivityDataAdd,
  TaskActivityDataList,
} from "../tasks/TaskActivityData";
import { UsersDataDelete } from "../users/UsersData";
import { ViewsDataGetDashboard } from "../views/ViewsData";

/**
 * Integration tests against a real SQLite database (no mocks): delete
 * cascades, attachment file cleanup, batched child loading (query-count
 * budgets) and the dashboard recently-done window.
 */

const dir = path.join(os.tmpdir(), `planner-integration-${Date.now()}`);
const now = new Date().toISOString();

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function insertUser(id: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
    [id, `user-${id}`, "x", "user", now],
  );
}

async function insertProject(id: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility) VALUES (?,?,?,?,?,?,?)",
    [id, `project-${id}`, "", 0, '["To Do", "Done"]', now, "public"],
  );
}

async function insertTask(
  id: string,
  projectId: string,
  status = "To Do",
  dateUpdated = now,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, `task-${id}`, "", status, "medium", "[]", now, dateUpdated],
  );
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await DbUtilsQuerySQL(sql, params);
  return Number(rows[0].c);
}

describe("delete cascades (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should delete a task with all child rows and attachment files", async () => {
    await insertUser("u-cascade-1");
    await insertProject("p-cascade-1");
    await insertTask("t-cascade-1", "p-cascade-1");
    await DbUtilsExecSQL(
      "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
      ["l-c1", "t-cascade-1", "bug"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-cascade-1", "u-cascade-1"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_comments (id, taskId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
      ["c-c1", "t-cascade-1", "u-cascade-1", "hi", now],
    );
    const filePath = path.join(dir, "attachments", "t-cascade-1.txt");
    await fs.outputFile(filePath, "content");
    await DbUtilsExecSQL(
      "INSERT INTO task_attachments (id, taskId, fileName, filePath, dateCreated) VALUES (?,?,?,?,?)",
      ["a-c1", "t-cascade-1", "file.txt", filePath, now],
    );

    await TasksDataDelete("t-cascade-1");

    expect(
      await count("SELECT COUNT(*) AS c FROM tasks WHERE id = ?", [
        "t-cascade-1",
      ]),
    ).toBe(0);
    for (const table of [
      "task_labels",
      "task_assignees",
      "task_comments",
      "task_attachments",
    ]) {
      expect(
        await count(`SELECT COUNT(*) AS c FROM ${table} WHERE taskId = ?`, [
          "t-cascade-1",
        ]),
      ).toBe(0);
    }
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it("should delete a note with all child rows and attachment files", async () => {
    await insertUser("u-cascade-2");
    await insertProject("p-cascade-2");
    const noteId = "n-cascade-2";
    await DbUtilsExecSQL(
      "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?)",
      [noteId, "p-cascade-2", "Note", "", now, now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO note_labels (id, noteId, name) VALUES (?,?,?)",
      ["nl-c2", noteId, "idea"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO note_comments (id, noteId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
      ["nc-c2", noteId, "u-cascade-2", "hi", now],
    );
    const filePath = path.join(dir, "attachments", "n-cascade-2.txt");
    await fs.outputFile(filePath, "content");
    await DbUtilsExecSQL(
      "INSERT INTO note_attachments (id, noteId, fileName, filePath, dateCreated) VALUES (?,?,?,?,?)",
      ["na-c2", noteId, "file.txt", filePath, now],
    );

    await NotesDataDelete(noteId);

    expect(
      await count("SELECT COUNT(*) AS c FROM notes WHERE id = ?", [noteId]),
    ).toBe(0);
    for (const table of ["note_labels", "note_comments", "note_attachments"]) {
      expect(
        await count(`SELECT COUNT(*) AS c FROM ${table} WHERE noteId = ?`, [
          noteId,
        ]),
      ).toBe(0);
    }
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it("should delete a project with its tasks, notes, access rows and attachment files", async () => {
    await insertUser("u-cascade-3");
    await insertProject("p-cascade-3");
    await insertTask("t-cascade-3", "p-cascade-3");
    await DbUtilsExecSQL(
      "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
      ["l-c3", "t-cascade-3", "bug"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?)",
      ["n-cascade-3", "p-cascade-3", "Note", "", now, now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
      ["p-cascade-3", "u-cascade-3"],
    );
    const taskFile = path.join(dir, "attachments", "t-cascade-3.txt");
    const noteFile = path.join(dir, "attachments", "n-cascade-3.txt");
    await fs.outputFile(taskFile, "content");
    await fs.outputFile(noteFile, "content");
    await DbUtilsExecSQL(
      "INSERT INTO task_attachments (id, taskId, fileName, filePath, dateCreated) VALUES (?,?,?,?,?)",
      ["a-c3", "t-cascade-3", "file.txt", taskFile, now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO note_attachments (id, noteId, fileName, filePath, dateCreated) VALUES (?,?,?,?,?)",
      ["na-c3", "n-cascade-3", "file.txt", noteFile, now],
    );

    await ProjectsDataDelete("p-cascade-3");

    expect(
      await count("SELECT COUNT(*) AS c FROM projects WHERE id = ?", [
        "p-cascade-3",
      ]),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS c FROM tasks WHERE projectId = ?", [
        "p-cascade-3",
      ]),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS c FROM notes WHERE projectId = ?", [
        "p-cascade-3",
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS c FROM project_users WHERE projectId = ?",
        ["p-cascade-3"],
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS c FROM task_labels WHERE taskId = ?", [
        "t-cascade-3",
      ]),
    ).toBe(0);
    expect(await fs.pathExists(taskFile)).toBe(false);
    expect(await fs.pathExists(noteFile)).toBe(false);
  });

  it("should delete a user with assignments, project access, api key and push subscriptions, keeping comments", async () => {
    await insertUser("u-cascade-4");
    await insertProject("p-cascade-4");
    await insertTask("t-cascade-4", "p-cascade-4");
    await DbUtilsExecSQL(
      "INSERT INTO task_comments (id, taskId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
      ["c-c4", "t-cascade-4", "u-cascade-4", "kept", now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-cascade-4", "u-cascade-4"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
      ["p-cascade-4", "u-cascade-4"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO api_keys (id, userId, key, keyHash, keyPrefix, dateCreated) VALUES (?,?,?,?,?,?)",
      ["k-c4", "u-cascade-4", "", "hash", "pk_c4", now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO push_subscriptions (userId, endpoint, keys, dateCreated) VALUES (?,?,?,?)",
      ["u-cascade-4", "https://example.com/sub", "{}", now],
    );

    await UsersDataDelete("u-cascade-4");

    expect(
      await count("SELECT COUNT(*) AS c FROM users WHERE id = ?", [
        "u-cascade-4",
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS c FROM task_assignees WHERE userId = ?",
        ["u-cascade-4"],
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS c FROM project_users WHERE userId = ?",
        ["u-cascade-4"],
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS c FROM api_keys WHERE userId = ?", [
        "u-cascade-4",
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS c FROM push_subscriptions WHERE userId = ?",
        ["u-cascade-4"],
      ),
    ).toBe(0);
    // Comments survive (author resolved through a join)
    expect(
      await count("SELECT COUNT(*) AS c FROM task_comments WHERE id = ?", [
        "c-c4",
      ]),
    ).toBe(1);
  });
});

describe("batched child loading (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    await insertUser("u-batch");
    await insertProject("p-batch");
    // 5 tasks with labels, assignees, comments and attachments each
    for (let i = 1; i <= 5; i++) {
      await insertTask(`t-batch-${i}`, "p-batch");
      await DbUtilsExecSQL(
        "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
        [`l-batch-${i}`, `t-batch-${i}`, "bug"],
      );
      await DbUtilsExecSQL(
        "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
        [`t-batch-${i}`, "u-batch"],
      );
      await DbUtilsExecSQL(
        "INSERT INTO task_comments (id, taskId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
        [`c-batch-${i}`, `t-batch-${i}`, "u-batch", "hi", now],
      );
      await DbUtilsExecSQL(
        "INSERT INTO task_attachments (id, taskId, fileName, filePath, dateCreated) VALUES (?,?,?,?,?)",
        [`a-batch-${i}`, `t-batch-${i}`, "f.txt", "/tmp/f.txt", now],
      );
    }
    // 4 notes with labels, comments and attachments each
    for (let i = 1; i <= 4; i++) {
      await DbUtilsExecSQL(
        "INSERT INTO notes (id, projectId, title, description, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?)",
        [`n-batch-${i}`, "p-batch", `note-${i}`, "", now, now],
      );
      await DbUtilsExecSQL(
        "INSERT INTO note_labels (id, noteId, name) VALUES (?,?,?)",
        [`nl-batch-${i}`, `n-batch-${i}`, "idea"],
      );
      await DbUtilsExecSQL(
        "INSERT INTO note_comments (id, noteId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
        [`nc-batch-${i}`, `n-batch-${i}`, "u-batch", "hi", now],
      );
    }
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should list tasks with a constant number of queries regardless of count", async () => {
    DbUtilsQueryCountReset();
    const tasks = await TasksDataList({ projectId: "p-batch" });
    // 1 main query + 5 batched child queries
    expect(DbUtilsQueryCountGet()).toBe(6);
    expect(tasks).toHaveLength(5);
    for (const task of tasks) {
      expect(task.labels).toEqual(["bug"]);
      expect(task.assignees.map((a) => a.userId)).toEqual(["u-batch"]);
      expect(task.comments).toHaveLength(1);
      expect(task.attachments).toHaveLength(1);
      expect(task.dependencies).toEqual([]);
    }
  });

  it("should list notes with a constant number of queries regardless of count", async () => {
    DbUtilsQueryCountReset();
    const notes = await NotesDataList({ projectId: "p-batch" });
    // 1 main query + 3 batched child queries
    expect(DbUtilsQueryCountGet()).toBe(4);
    expect(notes).toHaveLength(4);
    for (const note of notes) {
      expect(note.labels).toEqual(["idea"]);
      expect(note.comments).toHaveLength(1);
    }
  });

  it("should run an empty task list in a single query", async () => {
    DbUtilsQueryCountReset();
    const tasks = await TasksDataList({ projectId: "p-missing" });
    expect(DbUtilsQueryCountGet()).toBe(1);
    expect(tasks).toEqual([]);
  });
});

describe("tasks list fields projection (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    await insertUser("u-fields-1");
    await insertProject("p-fields");
    await insertTask("t-fields-1", "p-fields");
    await insertTask("t-fields-2", "p-fields", "Done");
    await DbUtilsExecSQL(
      "INSERT INTO task_comments (id, taskId, userId, text, dateCreated) VALUES (?,?,?,?,?)",
      ["c-fields-1", "t-fields-1", "u-fields-1", "hello", now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
      ["l-fields-1", "t-fields-1", "bug"],
    );
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should skip child queries for collections excluded by fields", async () => {
    DbUtilsQueryCountReset();
    const fields = new Set([
      "id",
      "title",
      "status",
      "checklist",
      "assignees",
      "labels",
    ]);
    const tasks = await TasksDataList({ projectId: "p-fields" }, fields);
    // 1 main query + assignees + labels; comments and attachments skipped
    expect(DbUtilsQueryCountGet()).toBe(3);
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.comments).toEqual([]);
      expect(task.attachments).toEqual([]);
    }
  });

  it("should run only the main query when no child collection is requested", async () => {
    DbUtilsQueryCountReset();
    const fields = new Set(["id", "title"]);
    const tasks = await TasksDataList({ projectId: "p-fields" }, fields);
    expect(DbUtilsQueryCountGet()).toBe(1);
    expect(tasks).toHaveLength(2);
    const task = tasks.find((t) => t.id === "t-fields-1");
    expect(task?.toTransportJson(fields)).toEqual({
      id: "t-fields-1",
      title: "task-t-fields-1",
    });
  });

  it("should hydrate the requested collections and omit the unrequested keys", async () => {
    const fields = new Set(["id", "title", "comments", "assignees", "labels"]);
    const tasks = await TasksDataList({ projectId: "p-fields" }, fields);
    const task = tasks.find((t) => t.id === "t-fields-1");
    const json = task?.toTransportJson(fields) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual([
      "assignees",
      "comments",
      "id",
      "labels",
      "title",
    ]);
    expect(task?.comments[0]).toMatchObject({
      id: "c-fields-1",
      userId: "u-fields-1",
      text: "hello",
    });
    expect(task?.assignees).toEqual([]);
    expect(task?.labels).toEqual(["bug"]);
  });

  it("should render requested-but-empty collections as empty arrays", async () => {
    const fields = new Set([
      "id",
      "description",
      "comments",
      "labels",
      "attachments",
    ]);
    const tasks = await TasksDataList({ projectId: "p-fields" }, fields);
    const task = tasks.find((t) => t.id === "t-fields-2");
    expect(task?.toTransportJson(fields)).toEqual({
      id: "t-fields-2",
      description: "",
      comments: [],
      labels: [],
      attachments: [],
    });
  });
});

describe("tasks list assigneeUserId filter (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    await insertUser("u-assignee-1");
    await insertUser("u-assignee-2");
    await insertProject("p-assignee");
    // t-1: only u-1, To Do; t-2: u-1 + u-2, Done (filter must match all statuses)
    await insertTask("t-assignee-1", "p-assignee");
    await insertTask("t-assignee-2", "p-assignee", "Done");
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-assignee-1", "u-assignee-1"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-assignee-2", "u-assignee-1"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-assignee-2", "u-assignee-2"],
    );
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should return only the given user's tasks, in all statuses", async () => {
    const tasks = await TasksDataList({
      projectId: "p-assignee",
      assigneeUserId: "u-assignee-2",
    });
    expect(tasks.map((t) => t.id)).toEqual(["t-assignee-2"]);
    expect(tasks[0].status).toBe("Done");
  });

  it("should match every task of the user when they are the only assignee", async () => {
    const tasks = await TasksDataList({
      projectIds: ["p-assignee"],
      assigneeUserId: "u-assignee-1",
    });
    expect(tasks.map((t) => t.id).sort()).toEqual([
      "t-assignee-1",
      "t-assignee-2",
    ]);
  });

  it("should compose assigneeUserId with the q filter", async () => {
    const tasks = await TasksDataList({
      assigneeUserId: "u-assignee-2",
      q: "task-t-assignee-1",
    });
    expect(tasks).toEqual([]);
  });
});

describe("dashboard recently-done window (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should only return done tasks updated within the last 30 days", async () => {
    await insertProject("p-window");
    await insertTask("t-fresh", "p-window", "Done", isoMinutesAgo(5));
    await insertTask("t-10days", "p-window", "Done", isoDaysAgo(10));
    await insertTask("t-40days", "p-window", "Done", isoDaysAgo(40));
    await insertTask("t-not-done", "p-window", "To Do", isoMinutesAgo(1));

    const data = await ViewsDataGetDashboard({ projectId: "p-window" });

    const ids = data.recentlyDone.map((t) => t.id).sort();
    expect(ids).toEqual(["t-10days", "t-fresh"]);
  });

  it("should cap recently-done at the 5 most recently updated", async () => {
    await insertProject("p-cap");
    for (let i = 1; i <= 6; i++) {
      await insertTask(`t-cap-${i}`, "p-cap", "Done", isoMinutesAgo(i));
    }

    const data = await ViewsDataGetDashboard({ projectId: "p-cap" });

    expect(data.recentlyDone).toHaveLength(5);
    expect(data.recentlyDone.map((t) => t.id)).toEqual([
      "t-cap-1",
      "t-cap-2",
      "t-cap-3",
      "t-cap-4",
      "t-cap-5",
    ]);
  });

  it("should cap the overdue/upcoming/no-date sections at the dashboard limit", async () => {
    await insertProject("p-limit");
    for (let i = 1; i <= 60; i++) {
      await DbUtilsExecSQL(
        "INSERT INTO tasks (id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          `t-limit-${i}`,
          "p-limit",
          `task-${i}`,
          "",
          "To Do",
          "medium",
          isoDaysAgo(1),
          "[]",
          now,
          now,
        ],
      );
    }

    const data = await ViewsDataGetDashboard({ projectId: "p-limit" });

    expect(data.overdue).toHaveLength(50);
    expect(data.noDate).toHaveLength(0);
    expect(data.upcoming).toHaveLength(0);
  });
});

describe("task activity feed (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should list the assigned tasks' activity newest first with actor and task title", async () => {
    await insertUser("u-feed-1");
    await insertUser("u-feed-2");
    await insertProject("p-feed");
    await insertTask("t-feed-1", "p-feed");
    await insertTask("t-feed-2", "p-feed");
    await insertTask("t-feed-3", "p-feed");
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-feed-1", "u-feed-1"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-feed-2", "u-feed-1"],
    );
    // u-feed-2 is only assigned to t-feed-3: its activity must not leak
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-feed-3", "u-feed-2"],
    );
    // Explicit dates: the list is ordered by dateCreated DESC
    const minutesAgo = (m: number) => isoMinutesAgo(m);
    await DbUtilsExecSQL(
      "INSERT INTO task_activity (id, taskId, actorUserId, summary, dateCreated) VALUES (?,?,?,?,?)",
      ["act-feed-1", "t-feed-1", "u-feed-2", "status: Done", minutesAgo(30)],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_activity (id, taskId, actorUserId, summary, dateCreated) VALUES (?,?,?,?,?)",
      ["act-feed-2", "t-feed-2", "u-feed-2", "New comment", minutesAgo(5)],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_activity (id, taskId, actorUserId, summary, dateCreated) VALUES (?,?,?,?,?)",
      ["act-feed-3", "t-feed-3", "u-feed-1", "Labels updated", minutesAgo(1)],
    );

    const feed = await TaskActivityDataList({
      assigneeUserId: "u-feed-1",
      limit: 50,
      offset: 0,
    });

    expect(feed.map((e) => e.id)).toEqual(["act-feed-2", "act-feed-1"]);
    expect(feed[0]).toMatchObject({
      taskId: "t-feed-2",
      taskTitle: "task-t-feed-2",
      actorName: "user-u-feed-2",
      summary: "New comment",
    });
    // Pagination picks up where the first page stopped
    const page2 = await TaskActivityDataList({
      assigneeUserId: "u-feed-1",
      limit: 1,
      offset: 1,
    });
    expect(page2.map((e) => e.id)).toEqual(["act-feed-1"]);
  });

  it("should hide activity in projects the user cannot see", async () => {
    await insertUser("u-feed-vis");
    await insertProject("p-feed-public");
    await DbUtilsExecSQL(
      "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility) VALUES (?,?,?,?,?,?,?)",
      ["p-feed-hidden", "hidden", "", 0, '["To Do", "Done"]', now, "restricted"],
    );
    await insertTask("t-feed-pub", "p-feed-public");
    await insertTask("t-feed-hid", "p-feed-hidden");
    for (const taskId of ["t-feed-pub", "t-feed-hid"]) {
      await DbUtilsExecSQL(
        "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
        [taskId, "u-feed-vis"],
      );
      await DbUtilsExecSQL(
        "INSERT INTO task_activity (id, taskId, actorUserId, summary, dateCreated) VALUES (?,?,?,?,?)",
        [`act-${taskId}`, taskId, "u-feed-vis", "New comment", now],
      );
    }

    const feed = await TaskActivityDataList({
      assigneeUserId: "u-feed-vis",
      visibleTo: { userId: "u-feed-vis" },
      limit: 50,
      offset: 0,
    });

    expect(feed.map((e) => e.taskId)).toEqual(["t-feed-pub"]);
  });

  it("should cascade task_activity rows when the task is deleted", async () => {
    await insertUser("u-feed-cascade");
    await insertProject("p-feed-cascade");
    await insertTask("t-feed-cascade", "p-feed-cascade");
    await TaskActivityDataAdd("t-feed-cascade", "u-feed-cascade", "New comment");
    expect(
      await count("SELECT COUNT(*) AS c FROM task_activity WHERE taskId = ?", [
        "t-feed-cascade",
      ]),
    ).toBe(1);

    await TasksDataDelete("t-feed-cascade");

    expect(
      await count("SELECT COUNT(*) AS c FROM task_activity WHERE taskId = ?", [
        "t-feed-cascade",
      ]),
    ).toBe(0);
  });

  it("should keep task_activity rows when the actor is deleted", async () => {
    await insertUser("u-feed-gone");
    await insertUser("u-feed-watcher");
    await insertProject("p-feed-gone");
    await insertTask("t-feed-gone", "p-feed-gone");
    await DbUtilsExecSQL(
      "INSERT INTO task_assignees (taskId, userId) VALUES (?,?)",
      ["t-feed-gone", "u-feed-watcher"],
    );
    await TaskActivityDataAdd("t-feed-gone", "u-feed-gone", "New comment");

    await UsersDataDelete("u-feed-gone");

    expect(
      await count(
        "SELECT COUNT(*) AS c FROM task_activity WHERE actorUserId = ?",
        ["u-feed-gone"],
      ),
    ).toBe(1);
    const feed = await TaskActivityDataList({
      assigneeUserId: "u-feed-watcher",
      limit: 50,
      offset: 0,
    });
    expect(feed).toHaveLength(1);
    // The deleted actor's name falls back to null instead of erasing history
    expect(feed[0].actorName).toBeNull();
  });
});

describe("task dependencies (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    await insertProject("p-deps");
    await insertTask("t-deps-1", "p-deps");
    await insertTask("t-deps-2", "p-deps");
    await insertTask("t-deps-3", "p-deps", "Done");
    await replaceDependencies("t-deps-1", ["t-deps-2", "t-deps-3"]);
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should hydrate the dependencies with the target title and status", async () => {
    const task = await TasksDataGet("t-deps-1");
    expect(task?.dependencies).toEqual([
      { taskId: "t-deps-2", title: "task-t-deps-2", status: "To Do" },
      { taskId: "t-deps-3", title: "task-t-deps-3", status: "Done" },
    ]);
    // The reverse direction is not a dependency of the target
    const target = await TasksDataGet("t-deps-2");
    expect(target?.dependencies).toEqual([]);
  });

  it("should hydrate dependencies through the list endpoint too", async () => {
    const tasks = await TasksDataList({ projectId: "p-deps" });
    const task = tasks.find((t) => t.id === "t-deps-1");
    expect(task?.dependencies).toHaveLength(2);
  });

  it("should replace the dependencies with a single call", async () => {
    await replaceDependencies("t-deps-1", ["t-deps-3"]);
    const task = await TasksDataGet("t-deps-1");
    expect(task?.dependencies.map((d) => d.taskId)).toEqual(["t-deps-3"]);
    // Clearing keeps the task with an empty list
    await replaceDependencies("t-deps-1", []);
    expect((await TasksDataGet("t-deps-1"))?.dependencies).toEqual([]);
    await replaceDependencies("t-deps-1", ["t-deps-2", "t-deps-3"]);
  });

  it("should cascade a delete on both sides of a dependency link", async () => {
    await replaceDependencies("t-deps-1", ["t-deps-2", "t-deps-3"]);
    // Deleting the dependency target removes the link
    await TasksDataDelete("t-deps-2");
    expect(
      await count("SELECT COUNT(*) AS c FROM task_dependencies WHERE taskId = ?", [
        "t-deps-1",
      ]),
    ).toBe(1);
    // Deleting the depending task removes its remaining rows
    await TasksDataDelete("t-deps-1");
    expect(
      await count("SELECT COUNT(*) AS c FROM task_dependencies"),
    ).toBe(0);
  });
});
