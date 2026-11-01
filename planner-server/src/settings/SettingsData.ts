import { DbUtilsGetType, DbUtilsQuerySQL, DbUtilsExecSQL } from "../utils/DbUtils";

/**
 * The settings table is a key-value JSON store (category, content): one row
 * per feature document, enforced by a unique index on category and written
 * with a single upsert so concurrent saves cannot create duplicates.
 */
export async function SettingsDataGet(category: string): Promise<string | null> {
  const { sql } = buildGetSettingsQuery(DbUtilsGetType());
  const rows = await DbUtilsQuerySQL(sql, [category]);
  if (rows.length === 0) {
    return null;
  }
  return (rows[0].content as string) ?? null;
}

export async function SettingsDataSave(
  category: string,
  content: string,
): Promise<void> {
  await DbUtilsExecSQL(buildUpsertSettingsQuery(DbUtilsGetType()).sql, [
    category,
    content,
  ]);
}

/**
 * Pure query builders (SQLite "?" style — DbUtilsQuerySQL renumbers them for
 * postgres) so both dialects can be unit-tested without a database.
 */
export function buildGetSettingsQuery(
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql: `SELECT ${quote("content")} FROM settings WHERE ${quote("category")} = ? LIMIT 1`,
  };
}

export function buildUpsertSettingsQuery(
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql:
      `INSERT INTO settings (${quote("category")}, ${quote("content")}) VALUES (?, ?)` +
      ` ON CONFLICT (${quote("category")}) DO UPDATE SET ${quote("content")} = excluded.${quote("content")}`,
  };
}
