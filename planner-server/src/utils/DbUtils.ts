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
 * Runs fn inside a database transaction. All DbUtilsExecSQL/DbUtilsQuerySQL
 * calls made from within fn join the same transaction (on PostgreSQL through
 * a dedicated pooled client; on SQLite BEGIN/COMMIT on the single connection,
 * serialized so concurrent callers cannot interleave).
 */
export async function DbUtilsTransaction<T>(fn: () => Promise<T>): Promise<T> {
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

  // Serialize SQLite transactions: one connection, no interleaving
  const previous = sqliteTransactionQueue;
  let release: () => void = () => {};
  sqliteTransactionQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    database.exec("BEGIN");
    try {
      const result = await fn();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    release();
  }
}

let sqliteTransactionQueue: Promise<void> = Promise.resolve();

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
    const stmt = database.prepare(sql);
    const result = stmt.run(...params);
    return Promise.resolve(result.changes);
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
    const stmt = database.prepare(sql);
    const rows = stmt.all(...params);
    return Promise.resolve(rows);
  }
}

export function DbUtilsGetType(): "sqlite" | "postgres" {
  return databaseType;
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
