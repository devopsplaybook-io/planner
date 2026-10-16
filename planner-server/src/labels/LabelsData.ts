import { DbUtilsGetType, DbUtilsQuerySQL } from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";

export interface LabelUsage {
  name: string;
  count: number;
}

export interface LabelListFilters {
  /** Case-insensitive substring matched against the label name. */
  q?: string;
  /** When set, restricts to labels of tasks/notes in projects visible to this user. */
  visibleTo?: { userId: string };
}

/**
 * Builds the label-count query for one label table: the distinct names with
 * usage counts, restricted to rows whose parent task/note sits in a project
 * visible to the given user (omitted for admins). The optional term is
 * matched as a case-insensitive substring of the name. Placeholders use
 * SQLite "?" style — DbUtilsQuerySQL converts them to $n for postgres. Pure
 * so it can be unit-tested for both SQL dialects without a database.
 */
export function buildLabelCountsQuery(
  options: {
    table: string;
    parentIdColumn: string;
    parentTable: string;
    userId?: string;
    q?: string;
  },
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) => (dbType === "postgres" ? `"${name}"` : name);
  const conditions: string[] = [];
  const params: unknown[] = [];
  const term = options.q?.trim();
  if (term) {
    // LIKE is case-insensitive for ASCII in sqlite; postgres needs ILIKE.
    // User-supplied wildcards and the escape character are neutralized so
    // they match literally (same as the task search).
    const like = dbType === "postgres" ? "ILIKE" : "LIKE";
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(`${quote("name")} ${like} ? ESCAPE '\\'`);
    params.push(pattern);
  }
  if (options.userId) {
    const visibility = visibleProjectsCondition(options.userId, dbType);
    conditions.push(
      `${quote(options.parentIdColumn)} IN (SELECT ${quote("id")} FROM ${quote(options.parentTable)} WHERE ${visibility.sql})`,
    );
    params.push(...visibility.params);
  }
  return {
    sql: `SELECT ${quote("name")}, COUNT(*) AS ${quote("count")} FROM ${quote(options.table)}${conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""} GROUP BY ${quote("name")}`,
    params,
  };
}

const LABEL_SOURCES = [
  { table: "task_labels", parentIdColumn: "taskId", parentTable: "tasks" },
  { table: "note_labels", parentIdColumn: "noteId", parentTable: "notes" },
] as const;

/**
 * Distinct labels across tasks and notes with their usage counts, ordered by
 * count descending then name. Non-admin viewers only see labels attached to
 * tasks/notes in projects visible to them, so restricted-project label
 * names never leak.
 */
export async function LabelsDataList(
  filters: LabelListFilters = {},
): Promise<LabelUsage[]> {
  const dbType = DbUtilsGetType();
  const counts = new Map<string, number>();
  await Promise.all(
    LABEL_SOURCES.map(async (source) => {
      const { sql, params } = buildLabelCountsQuery(
        { ...source, userId: filters.visibleTo?.userId, q: filters.q },
        dbType,
      );
      const rows = await DbUtilsQuerySQL(sql, params);
      for (const row of rows) {
        // postgres counts come back as strings (bigint)
        counts.set(
          row.name as string,
          (counts.get(row.name as string) || 0) + Number(row.count),
        );
      }
    }),
  );
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
