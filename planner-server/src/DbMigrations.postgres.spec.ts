import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Client } from "pg";
import { Config } from "./Config";
import {
  DbUtilsInit,
  DbUtilsClose,
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "./utils/DbUtils";
import { RunMigrations, SplitSqlStatements } from "./DbMigrations";

/**
 * Replays the PostgreSQL migration chain against a real server. Requires a
 * PostgreSQL 16 instance reachable through the DATABASE_POSTGRES_* variables;
 * skipped by default so `npm run test` stays database-free. Enabled in CI by
 * `.github/workflows/postgres-migration-tests.yml` (TEST_POSTGRES=1).
 */
const describePostgres =
  process.env.TEST_POSTGRES === "1" ? describe : describe.skip;

describePostgres("RunMigrations (PostgreSQL)", () => {
  jest.setTimeout(120000);

  const sqlDir = path.join(__dirname, "../sql/postgres");
  const databaseName = `planner_mig_test_${Date.now()}_${process.pid}`;
  const userId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const taskId = "33333333-3333-4333-8333-333333333333";
  let adminClient: Client;
  let config: Config;

  function newClient(database: string): Client {
    return new Client({
      host: process.env.DATABASE_POSTGRES_HOST || "localhost",
      port: parseInt(process.env.DATABASE_POSTGRES_PORT || "5432", 10),
      user: process.env.DATABASE_POSTGRES_USER || "planner",
      password: process.env.DATABASE_POSTGRES_PASSWORD || "planner",
      database,
    });
  }

  async function listSqlFiles(dir: string): Promise<string[]> {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  }

  async function readApplied(): Promise<string[]> {
    const rows = await DbUtilsQuerySQL(
      "SELECT value FROM metadata WHERE key = 'migrations'",
      [],
    );
    return JSON.parse(rows[0].value);
  }

  async function replayFiles(files: string[]): Promise<void> {
    for (const file of files) {
      const sql = await fs.readFile(path.join(sqlDir, file), "utf-8");
      for (const stmt of SplitSqlStatements(sql)) {
        await DbUtilsExecSQL(stmt, []);
      }
    }
  }

  async function hasPrimaryKey(table: string): Promise<boolean> {
    const rows = await DbUtilsQuerySQL(
      `SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'p' AND n.nspname = 'public' AND t.relname = ?`,
      [table],
    );
    return rows.length > 0;
  }

  async function columnType(table: string, column: string): Promise<string> {
    const rows = await DbUtilsQuerySQL(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    return rows[0]?.data_type as string;
  }

  beforeAll(async () => {
    adminClient = newClient(
      process.env.DATABASE_POSTGRES_ADMIN_DATABASE || "postgres",
    );
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
    process.env.DATABASE_POSTGRES_DATABASE = databaseName;
    config = new Config();
    config.DATABASE_TYPE = "postgres";
  });

  afterAll(async () => {
    await DbUtilsClose();
    if (adminClient) {
      await adminClient.query(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await adminClient.end();
    }
  });

  beforeEach(async () => {
    await DbUtilsClose();
    const reset = newClient(databaseName);
    await reset.connect();
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
    await reset.end();
    await DbUtilsInit(config);
  });

  afterEach(async () => {
    await DbUtilsClose();
  });

  it("should replay the complete chain on an empty database", async () => {
    await RunMigrations();

    const files = await listSqlFiles(sqlDir);
    expect(await readApplied()).toEqual(files);

    const tables = (
      await DbUtilsQuerySQL(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      )
    ).map((r) => r.tablename as string);
    for (const table of [
      "users",
      "projects",
      "tasks",
      "notes",
      "task_templates",
      "task_template_assignees",
      "task_template_comments",
      "task_template_runs",
      "task_activity",
      "task_dependencies",
      "project_users",
      "api_keys",
    ]) {
      expect(tables).toContain(table);
    }

    expect(await columnType("task_templates", "projectId")).toBe("uuid");
    expect(await columnType("task_template_assignees", "userId")).toBe("uuid");
    expect(await columnType("task_templates", "id")).toBe("character varying");
    expect(await columnType("task_templates", "instanceStatus")).toBe(
      "character varying",
    );

    for (const table of [
      "users",
      "projects",
      "tasks",
      "notes",
      "task_templates",
    ]) {
      expect(await hasPrimaryKey(table)).toBe(true);
    }
  });

  it("should replay the whole chain again when the metadata record is lost", async () => {
    await RunMigrations();
    await DbUtilsExecSQL(
      "INSERT INTO metadata (key, value) VALUES ('migrations', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["[]"],
    );

    await RunMigrations();

    const files = await listSqlFiles(sqlDir);
    const applied = await readApplied();
    expect(applied).toEqual(files);
    expect(new Set(applied).size).toBe(applied.length);
  });

  it("should upgrade a pre-task-template database (through init-0020) to the latest schema", async () => {
    await DbUtilsExecSQL(
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)",
      [],
    );
    const files = await listSqlFiles(sqlDir);
    const legacyFiles = files.filter((f) => f <= "init-0020.sql");
    expect(legacyFiles).toContain("init-0020.sql");
    expect(legacyFiles).not.toContain("init-0021.sql");
    await replayFiles(legacyFiles);
    await DbUtilsExecSQL(
      "INSERT INTO metadata (key, value) VALUES ('migrations', ?)",
      [JSON.stringify(legacyFiles)],
    );

    const now = new Date().toISOString();
    await DbUtilsExecSQL(
      `INSERT INTO users (id, name, "passwordEncrypted", role, "dateCreated") VALUES (?,?,?,?,?)`,
      [userId, "User", "x", "admin", now],
    );
    await DbUtilsExecSQL(
      `INSERT INTO projects (id, name, description, "isDefault", statuses, "dateCreated") VALUES (?,?,?,?,?,?)`,
      [projectId, "P", "", 0, '["To Do"]', now],
    );
    await DbUtilsExecSQL(
      `INSERT INTO tasks (id, "projectId", title, description, status, priority, checklist, "dateCreated", "dateUpdated") VALUES (?,?,?,?,?,?,?,?,?)`,
      [taskId, projectId, "T", "", "To Do", "medium", "[]", now, now],
    );

    await RunMigrations();

    const applied = await readApplied();
    expect(applied).toEqual(files);
    for (const file of ["init-0021.sql", "init-0022.sql", "init-0023.sql"]) {
      expect(applied.filter((f) => f === file)).toHaveLength(1);
    }

    const kept = await DbUtilsQuerySQL("SELECT id FROM users WHERE id = ?", [
      userId,
    ]);
    expect(kept).toHaveLength(1);
    const keptProjects = await DbUtilsQuerySQL(
      "SELECT id FROM projects WHERE id = ?",
      [projectId],
    );
    expect(keptProjects).toHaveLength(1);

    await DbUtilsExecSQL(
      `INSERT INTO task_templates (id, "projectId", title, "dateCreated", "dateUpdated") VALUES (?,?,?,?,?)`,
      ["tpl-1", projectId, "Template", now, now],
    );
    await DbUtilsExecSQL(
      `INSERT INTO task_template_assignees ("templateId", "userId") VALUES (?,?)`,
      ["tpl-1", userId],
    );
    const assignees = await DbUtilsQuerySQL(
      `SELECT "userId" FROM task_template_assignees WHERE "templateId" = ?`,
      ["tpl-1"],
    );
    expect(assignees).toHaveLength(1);

    await expect(
      DbUtilsExecSQL(
        `INSERT INTO task_templates (id, "projectId", title, "dateCreated", "dateUpdated") VALUES (?,?,?,?,?)`,
        ["tpl-orphan", "00000000-0000-0000-0000-000000000000", "Orphan", now, now],
      ),
    ).rejects.toThrow();

    expect(await columnType("task_templates", "instanceStatus")).toBe(
      "character varying",
    );
  });

  it("should add missing primary keys through init-0006 (legacy repair branch)", async () => {
    for (const table of ["users", "projects", "tasks", "notes"]) {
      await DbUtilsExecSQL(`CREATE TABLE ${table} (id UUID)`, []);
      expect(await hasPrimaryKey(table)).toBe(false);
    }

    const sql = await fs.readFile(path.join(sqlDir, "init-0006.sql"), "utf-8");
    for (const stmt of SplitSqlStatements(sql)) {
      await DbUtilsExecSQL(stmt, []);
    }

    for (const table of ["users", "projects", "tasks", "notes"]) {
      expect(await hasPrimaryKey(table)).toBe(true);
    }
  });

  it("should roll back a failing file and resume without replaying earlier files", async () => {
    const dir = path.join(
      os.tmpdir(),
      `planner-mig-pg-resume-${Date.now()}`,
    );
    const migrationsDir = path.join(dir, "migrations");
    await fs.ensureDir(migrationsDir);
    try {
      await fs.writeFile(
        path.join(migrationsDir, "0001-one.sql"),
        "CREATE TABLE good_one (id UUID);\n",
      );
      await fs.writeFile(
        path.join(migrationsDir, "0002-two.sql"),
        "CREATE TABLE good_two (id UUID);\n",
      );
      await fs.writeFile(
        path.join(migrationsDir, "0003-three.sql"),
        "CREATE TABLE bad_three (id UUID);\nSELECT * FROM missing_table;\n",
      );

      await expect(RunMigrations(migrationsDir)).rejects.toThrow();
      expect(await readApplied()).toEqual(["0001-one.sql", "0002-two.sql"]);
      const rolledBack = await DbUtilsQuerySQL(
        "SELECT to_regclass('public.bad_three') AS name",
      );
      expect(rolledBack[0].name).toBeNull();

      await fs.writeFile(
        path.join(migrationsDir, "0003-three.sql"),
        "CREATE TABLE good_three (id UUID);\n",
      );
      await RunMigrations(migrationsDir);
      expect(await readApplied()).toEqual([
        "0001-one.sql",
        "0002-two.sql",
        "0003-three.sql",
      ]);
      for (const table of ["good_one", "good_two", "good_three"]) {
        const reg = await DbUtilsQuerySQL("SELECT to_regclass(?) AS name", [
          `public.${table}`,
        ]);
        expect(reg[0].name).not.toBeNull();
      }
    } finally {
      await fs.remove(dir);
    }
  });
});
