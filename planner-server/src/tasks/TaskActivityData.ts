import { v4 as uuidv4 } from "uuid";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";

export interface TaskActivityListFilters {
  /** The feed scope: tasks assigned to this user. Applied to everyone, admins included. */
  assigneeUserId: string;
  /** When set, restricts results to projects visible to this user (non-admin viewers). */
  visibleTo?: { userId: string };
  /** Maximum number of rows returned (pagination). */
  limit?: number;
  offset?: number;
}

export interface TaskActivityEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  status: string;
  actorName: string | null;
  summary: string;
  dateCreated: string;
}

export async function TaskActivityDataAdd(
  taskId: string,
  actorUserId: string,
  summary: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_ACTIVITY[DbUtilsGetType()], [
    uuidv4(),
    taskId,
    actorUserId,
    summary,
    new Date().toISOString(),
  ]);
}

/**
 * Builds the update feed query for the given filters. Pure so it can be
 * unit-tested for both SQL dialects without a database. Placeholders use
 * SQLite "?" style — DbUtilsQuerySQL converts them to $n for postgres.
 */
export function buildListActivityQuery(
  filters: TaskActivityListFilters,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) =>
    dbType === "postgres" ? `"${name}"` : name;
  const conditions: string[] = [];
  const params: unknown[] = [];
  conditions.push(
    `EXISTS (SELECT 1 FROM ${quote("task_assignees")} ta WHERE ta.${quote("taskId")} = a.${quote("taskId")} AND ta.${quote("userId")} = ?)`,
  );
  params.push(filters.assigneeUserId);
  if (filters.visibleTo) {
    const visibility = visibleProjectsCondition(
      filters.visibleTo.userId,
      dbType,
    );
    conditions.push(visibility.sql);
    params.push(...visibility.params);
  }
  let limitClause = "";
  if (typeof filters.limit === "number" && filters.limit > 0) {
    limitClause = ` LIMIT ?`;
    params.push(filters.limit);
    if (typeof filters.offset === "number" && filters.offset > 0) {
      limitClause += ` OFFSET ?`;
      params.push(filters.offset);
    }
  }
  return {
    sql:
      `SELECT a.${quote("id")}, a.${quote("taskId")}, a.${quote("summary")}, a.${quote("dateCreated")}, ` +
      `u.${quote("name")} AS ${quote("actorName")}, t.${quote("title")} AS ${quote("taskTitle")}, ` +
      `t.${quote("projectId")} AS ${quote("projectId")}, t.${quote("status")} AS ${quote("status")} ` +
      `FROM ${quote("task_activity")} a ` +
      `JOIN ${quote("tasks")} t ON t.${quote("id")} = a.${quote("taskId")} ` +
      `LEFT JOIN ${quote("users")} u ON u.${quote("id")} = a.${quote("actorUserId")} ` +
      `WHERE ${conditions.join(" AND ")} ` +
      `ORDER BY a.${quote("dateCreated")} DESC${limitClause}`,
    params,
  };
}

export async function TaskActivityDataList(
  filters: TaskActivityListFilters,
): Promise<TaskActivityEntry[]> {
  const { sql, params } = buildListActivityQuery(filters);
  const rows = await DbUtilsQuerySQL(sql, params);
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    projectId: row.projectId,
    status: row.status,
    actorName: (row.actorName as string | null) ?? null,
    summary: row.summary,
    dateCreated: row.dateCreated,
  }));
}

const SQL_QUERIES = {
  INSERT_ACTIVITY: {
    postgres:
      'INSERT INTO task_activity ("id", "taskId", "actorUserId", "summary", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO task_activity (id, taskId, actorUserId, summary, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
};
