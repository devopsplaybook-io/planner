import { AsyncLocalStorage } from "async_hooks";
import { Config } from "../Config";

let databaseType: "sqlite" | "postgres" = "sqlite";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let database: any = null;
let queryCount = 0;

interface TransactionContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pgClient: any | null;
}

const transactionStorage = new AsyncLocalStorage<TransactionContext>();

export async function DbUtilsInit(config: Config): Promise<void> {
  databaseType = config.DATABASE_TYPE as "sqlite" | "postgres";
  if (databaseType === "postgres") {
    const { Pool } = await import("pg");
    database = new Pool({
      host: process.env.DATABASE_POSTGRES_HOST || "localhost",
      port: parseInt(process.env.DATABASE_POSTGRES_PORT || "5432"),
      user: process.env.DATABASE_POSTGRES_USER || "planner",
      password: process.env.DATABASE_POSTGRES_PASSWORD || "planner",
      database: process.env.DATABASE_POSTGRES_DATABASE || "planner",
    });
    await database.query("SELECT 1");
  } else {
    const Database = (await import("better-sqlite3")).default;
    database = new Database(`${config.DATA_DIR}/database.db`);
    database.pragma("journal_mode = WAL");
    // SQLite defaults to off: without this, declared FOREIGN KEY constraints
    // are parsed but never enforced.
    database.pragma("foreign_keys = ON");
  }
}

export function DbUtilsInitGetDatabase() {
  return database;
}

export async function DbUtilsClose(): Promise<void> {
  if (!database) {
    return;
  }
  if (databaseType === "postgres") {
    await database.end();
  } else {
    database.close();
  }
  database = null;
}

/** Convert SQLite ? placeholders to PostgreSQL $1, $2, ... numbering */
export function convertToPostgresPlaceholders(sql: string): string {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPostgresClient(): any {
  return transactionStorage.getStore()?.pgClient || database;
}

/**
 * Serializes access to the single SQLite connection: transactions and plain
 * statements queue up behind each other so a statement from another request
 * can never execute inside an open transaction. Work that already belongs to
 * the active transaction (recognized through AsyncLocalStorage) runs directly
 * because it owns the queue until the transaction settles.
 */
async function runSerialized<T>(fn: () => Promise<T> | T): Promise<T> {
  if (transactionStorage.getStore()) {
    return fn();
  }
  const previous = sqliteQueue;
  let release: () => void = () => {};
  sqliteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

let sqliteQueue: Promise<void> = Promise.resolve();

/**
 * Runs fn inside a database transaction. All DbUtilsExecSQL/DbUtilsQuerySQL
 * calls made from within fn join the same transaction (on PostgreSQL through
 * a dedicated pooled client; on SQLite BEGIN/COMMIT on the single connection).
 * Nested calls join the transaction already open in the async context instead
 * of starting another one. On SQLite every plain statement is serialized
 * against open transactions, so it can never be committed or rolled back with
 * one by accident.
 */
export async function DbUtilsTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionStorage.getStore()) {
    return fn();
  }
  if (databaseType === "postgres") {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await transactionStorage.run({ pgClient: client }, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Keep the original error
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // The open transaction holds the queue: its statements run directly
  return runSerialized(async () => {
    database.exec("BEGIN");
    try {
      const result = await transactionStorage.run({ pgClient: null }, fn);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
}

export function DbUtilsExecSQL(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  queryCount++;
  if (databaseType === "postgres") {
    return new Promise((resolve, reject) => {
      getPostgresClient().query(
        convertToPostgresPlaceholders(sql),
        params,
        (error: Error, result: { rowCount: number }) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.rowCount || 0);
          }
        },
      );
    });
  } else {
    return runSerialized(async () => {
      const stmt = database.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    });
  }
}

export function DbUtilsQuerySQL(
  sql: string,
  params: unknown[] = [],
  debug = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (debug) {
    console.log(sql);
  }
  queryCount++;
  if (databaseType === "postgres") {
    const convertedSql = convertToPostgresPlaceholders(sql);
    return new Promise((resolve, reject) => {
      getPostgresClient().query(
        convertedSql,
        params,
        (error: Error, result: { rows: unknown[] }) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.rows);
          }
        },
      );
    });
  } else {
    return runSerialized(async () => {
      const stmt = database.prepare(sql);
      return stmt.all(...params);
    });
  }
}

export function DbUtilsGetType(): "sqlite" | "postgres" {
  return databaseType;
}

/**
 * True when an insert/update failed because it violated a unique constraint
 * (PostgreSQL 23505, SQLite SQLITE_CONSTRAINT_UNIQUE): callers turn the race
 * between a pre-check and the write into a 409 instead of a 500.
 */
export function DbUtilsIsUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "23505") {
    return true;
  }
  if (
    typeof code === "string" &&
    code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  ) {
    return true;
  }
  return (
    typeof message === "string" && message.includes("UNIQUE constraint failed")
  );
}

/**
 * Number of SQL statements executed since the last reset. Used by
 * integration tests to pin query-count budgets (N+1 regressions).
 */
export function DbUtilsQueryCountGet(): number {
  return queryCount;
}

export function DbUtilsQueryCountReset(): void {
  queryCount = 0;
}
