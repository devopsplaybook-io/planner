import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  DbUtilsInit,
  DbUtilsClose,
  DbUtilsQuerySQL,
  DbUtilsExecSQL,
} from "./utils/DbUtils";
import { RunMigrations } from "./DbMigrations";
import { Config } from "./Config";

/**
 * Migration integration tests against a real SQLite database (no mocks):
 * a fresh bootstrap and an in-place upgrade of a database created before
 * init-0013 (token versions, API key hashing, cascading foreign keys).
 */

async function freshConfig(dir: string): Promise<Config> {
  await fs.remove(dir);
  await fs.ensureDir(dir);
  const config = new Config();
  config.DATA_DIR = dir;
  return config;
}

describe("RunMigrations (fresh database)", () => {
  const dir = path.join(os.tmpdir(), `planner-mig-fresh-${Date.now()}`);

  beforeAll(async () => {
    await DbUtilsInit(await freshConfig(dir));
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should create every table", async () => {
    const tables = (
      await DbUtilsQuerySQL(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
    ).map((r) => r.name as string);
    for (const table of [
      "api_keys",
      "metadata",
      "note_attachments",
      "note_comments",
      "note_labels",
      "notes",
      "projects",
      "push_subscriptions",
      "statuses",
      "task_assignees",
      "task_attachments",
      "task_comments",
      "task_dependencies",
      "task_labels",
      "tasks",
      "users",
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("should create cascading foreign keys for the child tables", async () => {
    const projectFks = await DbUtilsQuerySQL(
      "PRAGMA foreign_key_list(tasks)",
    );
    expect(
      projectFks.some(
        (fk) => fk.table === "projects" && fk.on_delete === "CASCADE",
      ),
    ).toBe(true);

    const userFks = await DbUtilsQuerySQL(
      "PRAGMA foreign_key_list(project_users)",
    );
    expect(userFks).toHaveLength(2);
    expect(userFks.every((fk) => fk.on_delete === "CASCADE")).toBe(true);

    const apiKeyFks = await DbUtilsQuerySQL(
      "PRAGMA foreign_key_list(api_keys)",
    );
    expect(
      apiKeyFks.some(
        (fk) => fk.table === "users" && fk.on_delete === "CASCADE",
      ),
    ).toBe(true);

    const dependencyFks = await DbUtilsQuerySQL(
      "PRAGMA foreign_key_list(task_dependencies)",
    );
    expect(dependencyFks).toHaveLength(2);
    expect(dependencyFks.every((fk) => fk.table === "tasks")).toBe(true);
    expect(dependencyFks.every((fk) => fk.on_delete === "CASCADE")).toBe(true);
  });

  it("should create the query indexes", async () => {
    const indexes = (
      await DbUtilsQuerySQL(
        "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
      )
    ).map((r) => r.name as string);
    expect(indexes).toContain("idx_tasks_projectId");
    expect(indexes).toContain("idx_task_labels_taskId");
    expect(indexes).toContain("idx_project_users_userId");
    expect(indexes).toContain("idx_api_keys_userId");
    expect(indexes).toContain("idx_task_dependencies_taskId");
    expect(indexes).toContain("idx_task_dependencies_dependsOnTaskId");
  });

  it("should enable foreign key enforcement and WAL mode", async () => {
    const fk = await DbUtilsQuerySQL("PRAGMA foreign_keys");
    expect(fk[0].foreign_keys).toBe(1);
    const journal = await DbUtilsQuerySQL("PRAGMA journal_mode");
    expect(journal[0].journal_mode).toBe("wal");
  });

  it("should cascade a project delete to its tasks", async () => {
    const now = new Date().toISOString();
    await DbUtilsExecSQL(
      "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility) VALUES (?,?,?,?,?,?,?)",
      ["p1", "P", "", 0, '["To Do"]', now, "public"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO tasks (id, projectId, title, description, status, priority, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?)",
      ["t1", "p1", "T", "", "To Do", "medium", "[]", now, now],
    );
    await DbUtilsExecSQL("DELETE FROM projects WHERE id = ?", ["p1"]);
    const remaining = await DbUtilsQuerySQL(
      "SELECT id FROM tasks WHERE projectId = 'p1'",
    );
    expect(remaining).toHaveLength(0);
  });

  it("should be idempotent when run twice", async () => {
    await RunMigrations();
    const applied = JSON.parse(
      (
        await DbUtilsQuerySQL(
          "SELECT value FROM metadata WHERE key = 'migrations'",
        )
      )[0].value,
    );
    expect(applied).toContain("init-0015.sql");
    expect(applied.filter((f: string) => f === "init-0015.sql")).toHaveLength(1);
  });
});

describe("RunMigrations (legacy database upgrade)", () => {
  const dir = path.join(os.tmpdir(), `planner-mig-legacy-${Date.now()}`);
  const now = new Date().toISOString();

  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);

    // Simulate a database migrated before init-0013 existed: apply
    // init-0000..init-0012 exactly like RunMigrations does, record them as
    // applied, then seed data — including orphan rows, which were possible
    // because foreign keys were declared but not enforced.
    await DbUtilsExecSQL(
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)",
    );
    const sqlDir = path.join(__dirname, "../sql/sqlite");
    const files = (await fs.readdir(sqlDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const legacyFiles = files.filter((f) => f <= "init-0012.sql");
    for (const file of legacyFiles) {
      const sql = await fs.readFile(path.join(sqlDir, file), "utf-8");
      const statements = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await DbUtilsExecSQL(stmt, []);
      }
    }
    await DbUtilsExecSQL(
      "INSERT INTO metadata (key, value) VALUES ('migrations', ?)",
      [JSON.stringify(legacyFiles)],
    );

    await DbUtilsExecSQL(
      "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated) VALUES (?,?,?,?,?)",
      ["u1", "User", "x", "admin", now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO projects (id, name, description, isDefault, statuses, dateCreated, visibility) VALUES (?,?,?,?,?,?,?)",
      ["p1", "P", "", 1, '["To Do"]', now, "public"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO tasks (id, projectId, title, description, status, priority, checklist, dateCreated, dateUpdated) VALUES (?,?,?,?,?,?,?,?,?)",
      ["t1", "p1", "T", "", "To Do", "medium", "[]", now, now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
      ["l1", "t1", "bug"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO api_keys (id, userId, key, dateCreated) VALUES (?,?,?,?)",
      ["k1", "u1", "pk_legacyplaintextkey", now],
    );
    await DbUtilsExecSQL(
      "INSERT INTO push_subscriptions (userId, endpoint, keys, dateCreated) VALUES (?,?,?,?)",
      ["u1", "https://example.com/sub", "{}", now],
    );
    await DbUtilsExecSQL("PRAGMA foreign_keys = OFF", []);
    await DbUtilsExecSQL(
      "INSERT INTO task_labels (id, taskId, name) VALUES (?,?,?)",
      ["l-orphan", "missing-task", "orphan"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
      ["p1", "u1"],
    );
    await DbUtilsExecSQL(
      "INSERT INTO project_users (projectId, userId) VALUES (?,?)",
      ["missing-project", "u1"],
    );
    await DbUtilsExecSQL("PRAGMA foreign_keys = ON", []);

    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should record the upgrade migrations as applied", async () => {
    const applied = JSON.parse(
      (
        await DbUtilsQuerySQL(
          "SELECT value FROM metadata WHERE key = 'migrations'",
        )
      )[0].value,
    );
    for (const file of ["init-0013.sql", "init-0014.sql", "init-0015.sql"]) {
      expect(applied).toContain(file);
    }
  });

  it("should remove child rows whose parent is missing", async () => {
    const labels = await DbUtilsQuerySQL("SELECT id FROM task_labels ORDER BY id");
    expect(labels.map((r) => r.id)).toEqual(["l1"]);
    const projectUsers = await DbUtilsQuerySQL("SELECT * FROM project_users");
    expect(projectUsers).toHaveLength(1);
    expect(projectUsers[0].projectId).toBe("p1");
  });

  it("should add the tokenVersion column to users", async () => {
    const users = await DbUtilsQuerySQL(
      "SELECT tokenVersion FROM users WHERE id = 'u1'",
    );
    expect(users[0].tokenVersion).toBe(0);
  });

  it("should add the API key hashing columns", async () => {
    const keys = await DbUtilsQuerySQL(
      "SELECT * FROM api_keys WHERE id = 'k1'",
    );
    expect(keys[0]).toHaveProperty("keyHash");
    expect(keys[0]).toHaveProperty("keyPrefix");
    expect(keys[0]).toHaveProperty("expiresAt");
  });

  it("should preserve the task columns through the table rebuild", async () => {
    const columns = (
      await DbUtilsQuerySQL("PRAGMA table_info(tasks)")
    ).map((c) => c.name as string);
    for (const column of [
      "id",
      "projectId",
      "title",
      "status",
      "checklist",
      "dateUpdated",
    ]) {
      expect(columns).toContain(column);
    }
  });

  it("should attach cascading foreign keys after the rebuild", async () => {
    const fks = await DbUtilsQuerySQL("PRAGMA foreign_key_list(task_labels)");
    expect(
      fks.some((fk) => fk.table === "tasks" && fk.on_delete === "CASCADE"),
    ).toBe(true);
  });

  it("should cascade a user delete to api_keys, push subscriptions and project access", async () => {
    await DbUtilsExecSQL("DELETE FROM users WHERE id = 'u1'");
    const counts = await DbUtilsQuerySQL(
      "SELECT (SELECT COUNT(*) FROM api_keys) AS apiKeys, (SELECT COUNT(*) FROM push_subscriptions) AS pushSubs, (SELECT COUNT(*) FROM project_users) AS projectUsers",
    );
    expect(counts[0].apiKeys).toBe(0);
    expect(counts[0].pushSubs).toBe(0);
    expect(counts[0].projectUsers).toBe(0);
  });
});
