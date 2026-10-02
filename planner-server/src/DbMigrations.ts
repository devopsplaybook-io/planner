import { promises as fs } from "fs-extra";
import * as path from "path";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "./utils/DbUtils";

/**
 * Applies the SQL migrations of the configured engine (sql/${type}/*.sql)
 * that were not applied yet, in file order, and records them in the
 * "metadata" table. Runs identically on SQLite and PostgreSQL.
 */
export async function RunMigrations(): Promise<void> {
  const dbType = DbUtilsGetType();
  const migrationsDir = path.join(__dirname, `../sql/${dbType}`);

  // Ensure metadata table exists for tracking migrations
  await DbUtilsExecSQL(
    `CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)`,
    [],
  );

  // Get already applied migrations
  const rows = await DbUtilsQuerySQL(
    "SELECT value FROM metadata WHERE key = 'migrations'",
    [],
  );
  const applied: string[] =
    rows.length > 0 && rows[0].value ? JSON.parse(rows[0].value) : [];

  // Read and apply new migrations in order
  const files = (await fs.readdir(migrationsDir))
    .filter((f: string) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (!applied.includes(file)) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8");
      console.log(`Running migration: ${file}`);
      // Split by semicolons and execute each statement. Full-line comments
      // are dropped first so a ";" inside a comment can never split a
      // statement.
      const statements = sql
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      for (const stmt of statements) {
        await DbUtilsExecSQL(stmt, []);
      }
      applied.push(file);
    }
  }

  // Save applied migrations (upsert valid on both SQLite and PostgreSQL)
  await DbUtilsExecSQL(
    "INSERT INTO metadata (key, value) VALUES ('migrations', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(applied)],
  );
}
