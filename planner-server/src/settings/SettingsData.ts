import { DbUtilsGetType, DbUtilsQuerySQL, DbUtilsExecSQL } from "../utils/DbUtils";

/**
 * The settings table is a key-value JSON store (category, content): one row
 * per feature document. There is no unique constraint on category, so the
 * save is UPDATE-then-INSERT rather than upsert-on-conflict.
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
  const changed = await DbUtilsExecSQL(
    buildUpdateSettingsQuery(DbUtilsGetType()).sql,
    [content, category],
  );
  if (changed === 0) {
    await DbUtilsExecSQL(buildInsertSettingsQuery(DbUtilsGetType()).sql, [
      category,
      content,
    ]);
  }
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

export function buildUpdateSettingsQuery(
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql: `UPDATE settings SET ${quote("content")} = ? WHERE ${quote("category")} = ?`,
  };
}

export function buildInsertSettingsQuery(
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  return {
    sql: `INSERT INTO settings (${quote("category")}, ${quote("content")}) VALUES (?, ?)`,
  };
}
