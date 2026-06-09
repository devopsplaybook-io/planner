import { Config } from "../Config";

let databaseType: "sqlite" | "postgres" = "sqlite";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let database: any = null;

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
  }
}

export function DbUtilsInitGetDatabase() {
  return database;
}

/** Convert SQLite ? placeholders to PostgreSQL $1, $2, ... numbering */
export function convertToPostgresPlaceholders(sql: string): string {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

export function DbUtilsExecSQL(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  if (databaseType === "postgres") {
    return new Promise((resolve, reject) => {
      database.query(
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
  if (databaseType === "postgres") {
    const convertedSql = convertToPostgresPlaceholders(sql);
    return new Promise((resolve, reject) => {
      database.query(
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
