import { promises as fs } from "fs-extra";
import * as path from "path";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "./utils/DbUtils";

/**
 * Splits a SQL script into individual statements on the semicolons that are
 * outside single-quoted strings, double-quoted identifiers, dollar-quoted
 * blocks ($$...$$ / $tag$...$tag$) and "--" line comments.
 */
export function SplitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        i++;
      }
      current += "\n";
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      current += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          current += quote + quote;
          i += 2;
          continue;
        }
        current += sql[i];
        i++;
        if (sql[i - 1] === quote) {
          break;
        }
      }
      continue;
    }

    if (ch === "$") {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ";") {
      if (current.trim().length > 0) {
        statements.push(current.trim());
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }
  return statements;
}

async function RecordAppliedMigration(
  applied: string[],
  file: string,
): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO metadata (key, value) VALUES ('migrations', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [JSON.stringify([...applied, file])],
  );
}

/**
 * Applies the SQL migrations of the configured engine (sql/${type}/*.sql)
 * that were not applied yet, in file order, and records each one right after
 * it succeeds so a failure never replays already-applied files. Runs
 * identically on SQLite and PostgreSQL; on PostgreSQL each file is applied
 * in a transaction that also covers its metadata record.
 */
export async function RunMigrations(
  migrationsDir = path.join(__dirname, `../sql/${DbUtilsGetType()}`),
): Promise<void> {
  const dbType = DbUtilsGetType();

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
    if (applied.includes(file)) {
      continue;
    }
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8");
    console.log(`Running migration: ${file}`);
    const statements = SplitSqlStatements(sql);

    if (dbType === "postgres") {
      // PostgreSQL supports transactional DDL: a failing file rolls back
      // completely, including its "migrations" metadata record.
      await DbUtilsTransaction(async () => {
        for (const stmt of statements) {
          await DbUtilsExecSQL(stmt, []);
        }
        await RecordAppliedMigration(applied, file);
      });
    } else {
      // SQLite migration files toggle PRAGMA foreign_keys, which is a no-op
      // inside a transaction, so files cannot be wrapped in one. Each file
      // is still recorded as soon as it succeeds.
      for (const stmt of statements) {
        await DbUtilsExecSQL(stmt, []);
      }
      await RecordAppliedMigration(applied, file);
    }

    applied.push(file);
  }
}
