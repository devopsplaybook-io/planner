import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import { Config } from "../Config";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { TaskTemplate } from "../model/TaskTemplate";
import { TasksDataAdd } from "../tasks/TasksData";
import { NotesDataAdd } from "../notes/NotesData";
import { TaskTemplatesAdd } from "../tasktemplates/TaskTemplatesData";
import { createInstanceFromTemplate } from "../tasktemplates/TaskTemplatesInstance";
import {
  ProjectsDataGet,
  ProjectsDataUpdate,
  addProjectUser,
  getProjectUsers,
} from "../projects/ProjectsData";

/**
 * Real-database proof of the write-path integrity fixes: parent and child
 * rows are inserted atomically, plain statements never run inside an open
 * transaction, and the project access / template instance rewrites are
 * all-or-nothing.
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

async function countAllRows(table: string) {
  const rows = await DbUtilsQuerySQL(`SELECT COUNT(*) AS c FROM ${table}`);
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
    await insertProject("p-access");
    await insertUser("u-integrity");
    await insertUser("u-integrity-2");
    await insertUser("u-access");
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

  // ==================== M2: statement isolation ====================

  it("should join a nested transaction and roll back together", async () => {
    const task = makeTask("p-integrity");

    await expect(
      DbUtilsTransaction(async () => {
        // Nested call joins the outer transaction instead of deadlocking
        await DbUtilsTransaction(async () => {
          await TasksDataAdd(task);
        });
        expect(await countRows("tasks", "id", task.id)).toBe(1);
        throw new Error("abort outer");
      }),
    ).rejects.toThrow("abort outer");

    expect(await countRows("tasks", "id", task.id)).toBe(0);
  });

  it("should not run a plain statement inside an open transaction", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let transactionReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      transactionReady = resolve;
    });

    const transaction = DbUtilsTransaction(async () => {
      await insertUser("u-inside-tx");
      transactionReady();
      await gate;
      throw new Error("rollback");
    });
    await ready;

    let plainInsertDone = false;
    const plainInsert = DbUtilsExecSQL(
      "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
      ["u-plain-outside", "user-plain", "x", "user", now],
    ).then((changes) => {
      plainInsertDone = true;
      return changes;
    });

    // Give the queued statement time to run if it were not serialized
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(plainInsertDone).toBe(false);

    releaseGate();
    await expect(transaction).rejects.toThrow("rollback");
    await plainInsert;

    expect(await countRows("users", "id", "u-inside-tx")).toBe(0);
    expect(await countRows("users", "id", "u-plain-outside")).toBe(1);
  });

  // ==================== M3: transactional access rewrite ====================

  it("should keep the previous access list when a replacement fails", async () => {
    await addProjectUser("p-access", "u-access", "view");
    const failing = await ProjectsDataGet("p-access");
    failing.name = "Renamed";

    await expect(
      ProjectsDataUpdate(failing, [
        { userId: "u-access", permission: "view" },
        { userId: "ghost", permission: "view" },
      ]),
    ).rejects.toThrow();

    const unchanged = await ProjectsDataGet("p-access");
    expect(unchanged.name).toBe("project-p-access");
    expect(await getProjectUsers("p-access")).toEqual([
      { userId: "u-access", permission: "view" },
    ]);

    const updated = await ProjectsDataGet("p-access");
    updated.name = "Renamed";
    await ProjectsDataUpdate(updated, [
      { userId: "u-access", permission: "comment" },
    ]);

    expect((await ProjectsDataGet("p-access")).name).toBe("Renamed");
    expect(await getProjectUsers("p-access")).toEqual([
      { userId: "u-access", permission: "comment" },
    ]);
  });

  // ==================== M4: atomic template instance ====================

  it("should create a template instance with its attachment and run together", async () => {
    const attachmentDir = path.join(dir, "attachments", "template-ok");
    await fs.ensureDir(attachmentDir);
    const sourcePath = path.join(attachmentDir, "source.txt");
    await fs.writeFile(sourcePath, "attachment content");

    const template = new TaskTemplate();
    template.projectId = "p-integrity";
    template.title = "Template with attachment";
    template.attachments = [
      {
        id: "att-source",
        fileName: "source.txt",
        filePath: sourcePath,
        dateCreated: now,
      },
    ];
    await TaskTemplatesAdd(template);

    const project = await ProjectsDataGet("p-integrity");
    const task = await createInstanceFromTemplate(template, project);

    expect(await countRows("tasks", "id", task.id)).toBe(1);
    expect(await countRows("task_attachments", "taskId", task.id)).toBe(1);
    expect(
      await countRows("task_template_runs", "templateId", template.id),
    ).toBe(1);
    expect(task.attachments).toHaveLength(1);
    expect(await fs.readdir(attachmentDir)).toHaveLength(2);
  });

  it("should roll the instance back and remove copies when the run fails", async () => {
    const attachmentDir = path.join(dir, "attachments", "template-fail");
    await fs.ensureDir(attachmentDir);
    const sourcePath = path.join(attachmentDir, "only-source.txt");
    await fs.writeFile(sourcePath, "attachment content");

    // Never persisted: the run insert violates the templateId foreign key
    const template = new TaskTemplate();
    template.projectId = "p-integrity";
    template.title = "Unpersisted template";
    template.attachments = [
      {
        id: "att-source",
        fileName: "only-source.txt",
        filePath: sourcePath,
        dateCreated: now,
      },
    ];

    const project = await ProjectsDataGet("p-integrity");
    const tasksBefore = await countRows("tasks", "projectId", "p-integrity");
    const attachmentsBefore = await countAllRows("task_attachments");

    await expect(createInstanceFromTemplate(template, project)).rejects.toThrow();

    expect(await countRows("tasks", "projectId", "p-integrity")).toBe(
      tasksBefore,
    );
    expect(await countAllRows("task_attachments")).toBe(attachmentsBefore);
    expect(
      await countRows("task_template_runs", "templateId", template.id),
    ).toBe(0);
    expect(await fs.readdir(attachmentDir)).toEqual(["only-source.txt"]);
  });
});
