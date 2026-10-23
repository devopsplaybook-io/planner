import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { Config } from "../Config";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { TaskTemplate } from "../model/TaskTemplate";
import { TasksDataAdd } from "../tasks/TasksData";
import { NotesDataAdd } from "../notes/NotesData";
import { TaskTemplatesAdd } from "../tasktemplates/TaskTemplatesData";

/**
 * Real-database proof of the write-path integrity fixes (M1): parent and
 * child rows are inserted atomically, so a failing child leaves no partial
 * parent behind, and the transaction queue is released after a failure.
 */

const dir = path.join(
  os.tmpdir(),
  `planner-write-path-integrity-${Date.now()}`,
);
const now = new Date().toISOString();

async function insertUser(id: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
    [id, `user-${id}`, "x", "user", now],
  );
}

async function insertProject(id: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility, archived) VALUES (?,?,?,?,?,?,?,?)",
    [id, `project-${id}`, "", 0, '["To Do", "Done"]', now, "public", 0],
  );
}

async function countRows(table: string, column: string, value: string) {
  const rows = await DbUtilsQuerySQL(
    `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`,
    [value],
  );
  return Number(rows[0].c);
}

function makeTask(projectId: string): Task {
  const task = new Task();
  task.projectId = projectId;
  task.title = "Task";
  return task;
}

describe("write path integrity (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();

    await insertProject("p-integrity");
    await insertUser("u-integrity");
    await insertUser("u-integrity-2");
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should roll back a task creation that references an unknown assignee", async () => {
    const failed = makeTask("p-integrity");
    failed.assignees = [{ userId: "ghost" }];

    await expect(TasksDataAdd(failed)).rejects.toThrow();
    expect(await countRows("tasks", "id", failed.id)).toBe(0);
    expect(await countRows("task_assignees", "taskId", failed.id)).toBe(0);

    const retried = makeTask("p-integrity");
    retried.assignees = [{ userId: "u-integrity" }];
    await expect(TasksDataAdd(retried)).resolves.toBeUndefined();
    expect(await countRows("tasks", "id", retried.id)).toBe(1);
    expect(await countRows("task_assignees", "taskId", retried.id)).toBe(1);
  });

  it("should roll back a task creation with an unknown dependency", async () => {
    const failed = makeTask("p-integrity");
    failed.dependencies = [{ taskId: "missing-task" }];

    await expect(TasksDataAdd(failed)).rejects.toThrow();
    expect(await countRows("tasks", "id", failed.id)).toBe(0);
    expect(await countRows("task_dependencies", "taskId", failed.id)).toBe(0);

    const retried = makeTask("p-integrity");
    await expect(TasksDataAdd(retried)).resolves.toBeUndefined();
    expect(await countRows("tasks", "id", retried.id)).toBe(1);
  });

  it("should roll back a note creation with an invalid label", async () => {
    const failed = new Note();
    failed.projectId = "p-integrity";
    failed.title = "Note";
    failed.labels = [null as unknown as string];

    await expect(NotesDataAdd(failed)).rejects.toThrow();
    expect(await countRows("notes", "id", failed.id)).toBe(0);
    expect(await countRows("note_labels", "noteId", failed.id)).toBe(0);

    const retried = new Note();
    retried.projectId = "p-integrity";
    retried.title = "Note";
    retried.labels = ["kept"];
    await expect(NotesDataAdd(retried)).resolves.toBeUndefined();
    expect(await countRows("notes", "id", retried.id)).toBe(1);
    expect(await countRows("note_labels", "noteId", retried.id)).toBe(1);
  });

  it("should roll back a template creation with an unknown assignee", async () => {
    const failed = new TaskTemplate();
    failed.projectId = "p-integrity";
    failed.title = "Template";
    failed.assignees = [{ userId: "ghost" }];

    await expect(TaskTemplatesAdd(failed)).rejects.toThrow();
    expect(await countRows("task_templates", "id", failed.id)).toBe(0);
    expect(
      await countRows("task_template_assignees", "templateId", failed.id),
    ).toBe(0);

    const retried = new TaskTemplate();
    retried.projectId = "p-integrity";
    retried.title = "Template";
    retried.assignees = [{ userId: "u-integrity" }];
    await expect(TaskTemplatesAdd(retried)).resolves.toBeUndefined();
    expect(await countRows("task_templates", "id", retried.id)).toBe(1);
    expect(
      await countRows("task_template_assignees", "templateId", retried.id),
    ).toBe(1);
  });

  it("should persist a task with its assignees, labels and dependencies", async () => {
    const dependency = makeTask("p-integrity");
    await TasksDataAdd(dependency);

    const task = makeTask("p-integrity");
    task.assignees = [{ userId: "u-integrity" }, { userId: "u-integrity-2" }];
    task.labels = ["urgent", "backend"];
    task.dependencies = [{ taskId: dependency.id }];
    await TasksDataAdd(task);

    expect(await countRows("tasks", "id", task.id)).toBe(1);
    expect(await countRows("task_assignees", "taskId", task.id)).toBe(2);
    expect(await countRows("task_labels", "taskId", task.id)).toBe(2);
    expect(await countRows("task_dependencies", "taskId", task.id)).toBe(1);
  });
});
