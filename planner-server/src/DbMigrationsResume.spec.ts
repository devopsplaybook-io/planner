import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "./Config";
import { DbUtilsInit, DbUtilsClose, DbUtilsQuerySQL } from "./utils/DbUtils";
import { RunMigrations } from "./DbMigrations";

/**
 * The runner must record each migration file as soon as it succeeds: after a
 * failure, restarting must not replay the files that already succeeded (their
 * CREATE TABLE statements are intentionally not idempotent here).
 */
describe("RunMigrations (per-file recording on SQLite)", () => {
  const dir = path.join(os.tmpdir(), `planner-mig-resume-${Date.now()}`);
  const migrationsDir = path.join(dir, "migrations");

  async function readApplied(): Promise<string[]> {
    const rows = await DbUtilsQuerySQL(
      "SELECT value FROM metadata WHERE key = 'migrations'",
      [],
    );
    return JSON.parse(rows[0].value);
  }

  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(migrationsDir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await fs.writeFile(
      path.join(migrationsDir, "001-one.sql"),
      "CREATE TABLE one (id INTEGER PRIMARY KEY);\n",
    );
    await fs.writeFile(
      path.join(migrationsDir, "002-two.sql"),
      "CREATE TABLE two (id INTEGER PRIMARY KEY);\n",
    );
    await fs.writeFile(
      path.join(migrationsDir, "003-three.sql"),
      "INSERT INTO missing_table (id) VALUES (1);\n",
    );
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should record only the files that succeeded when a later file fails", async () => {
    await expect(RunMigrations(migrationsDir)).rejects.toThrow();
    expect(await readApplied()).toEqual(["001-one.sql", "002-two.sql"]);
  });

  it("should not replay already applied files once the failure is fixed", async () => {
    await fs.writeFile(
      path.join(migrationsDir, "003-three.sql"),
      "CREATE TABLE three (id INTEGER PRIMARY KEY);\n",
    );
    await RunMigrations(migrationsDir);
    expect(await readApplied()).toEqual([
      "001-one.sql",
      "002-two.sql",
      "003-three.sql",
    ]);
    const tables = (
      await DbUtilsQuerySQL(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
    ).map((r) => r.name as string);
    expect(tables).toEqual(
      expect.arrayContaining(["metadata", "one", "two", "three"]),
    );
  });
});
