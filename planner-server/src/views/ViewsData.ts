import { DbUtilsQuerySQL, DbUtilsGetType } from "../utils/DbUtils";
import { visibleProjectsCondition } from "../projects/ProjectVisibility";
import { buildInPlaceholders } from "../tasks/TasksData";

/** Cap per dashboard section (recently-done keeps its spec'd 5). */
export const DASHBOARD_SECTION_LIMIT = 50;

export interface NextViewTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
  labels: string[];
}

export interface NextViewData {
  overdue: NextViewTask[];
  upcoming: NextViewTask[];
  noDate: NextViewTask[];
  recentlyDone: NextViewTask[];
}

export interface DashboardFilters {
  projectId?: string;
  /** Subtree filter: matches tasks in any of these projects (IN). */
  projectIds?: string[];
  labels?: string[];
  /** When set, restricts results to projects visible to this user (non-admin viewers). */
  visibleTo?: { userId: string };
}

function getSelectSql(): string {
  return DbUtilsGetType() === "postgres"
    ? 'SELECT id, "projectId", title, status, priority, "dueDate" FROM tasks'
    : "SELECT id, projectId, title, status, priority, dueDate FROM tasks";
}

function col(name: string): string {
  return DbUtilsGetType() === "postgres" ? `"${name}"` : name;
}

function orderDueDateAsc(): string {
  return `ORDER BY ${col("dueDate")} ASC, CASE ${col("priority")} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;
}

function orderPriorityAsc(): string {
  return `ORDER BY CASE ${col("priority")} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;
}

function orderDateUpdatedDesc(): string {
  return `ORDER BY ${col("dateUpdated")} DESC`;
}

export async function ViewsDataGetDashboard(
  filters?: DashboardFilters,
): Promise<NextViewData> {
  const now = new Date().toISOString();
  const in1Month = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const dueCol = col("dueDate");
  const statCol = col("status");

  // Build optional filter clause
  const filterConditions: string[] = [];
  const filterParams: unknown[] = [];

  if (filters?.projectId) {
    filterConditions.push(`${col("projectId")} = ?`);
    filterParams.push(filters.projectId);
  }

  if (filters?.projectIds && filters.projectIds.length > 0) {
    const placeholders = filters.projectIds.map(() => "?").join(", ");
    filterConditions.push(`${col("projectId")} IN (${placeholders})`);
    filterParams.push(...filters.projectIds);
  }

  if (filters?.labels && filters.labels.length > 0) {
    const placeholders = filters.labels.map(() => "?").join(", ");
    filterConditions.push(
      `id IN (SELECT ${col("taskId")} FROM task_labels WHERE name IN (${placeholders}))`,
    );
    filterParams.push(...filters.labels);
  }

  if (filters?.visibleTo) {
    const visibility = visibleProjectsCondition(
      filters.visibleTo.userId,
      DbUtilsGetType(),
    );
    filterConditions.push(visibility.sql);
    filterParams.push(...visibility.params);
  }

  const filterClause =
    filterConditions.length > 0 ? ` AND ${filterConditions.join(" AND ")}` : "";

  // Overdue: dueDate IS NOT NULL AND dueDate < now AND status != 'Done'
  const overdueSql = `${getSelectSql()} WHERE ${dueCol} IS NOT NULL AND ${dueCol} < ? AND ${statCol} != ?${filterClause} ${orderDueDateAsc()} LIMIT ${DASHBOARD_SECTION_LIMIT}`;
  const overdueRows = await DbUtilsQuerySQL(overdueSql, [
    now,
    "Done",
    ...filterParams,
  ]);

  // Upcoming (1 month): dueDate >= now AND dueDate <= now+1month AND status != 'Done'
  const upcomingSql = `${getSelectSql()} WHERE ${dueCol} IS NOT NULL AND ${dueCol} >= ? AND ${dueCol} <= ? AND ${statCol} != ?${filterClause} ${orderDueDateAsc()} LIMIT ${DASHBOARD_SECTION_LIMIT}`;
  const upcomingRows = await DbUtilsQuerySQL(upcomingSql, [
    now,
    in1Month,
    "Done",
    ...filterParams,
  ]);

  // No date, ordered by priority: dueDate IS NULL AND status != 'Done'
  const noDateSql = `${getSelectSql()} WHERE ${dueCol} IS NULL AND ${statCol} != ?${filterClause} ${orderPriorityAsc()} LIMIT ${DASHBOARD_SECTION_LIMIT}`;
  const noDateRows = await DbUtilsQuerySQL(noDateSql, [
    "Done",
    ...filterParams,
  ]);

  // Recently done (spec VIEWS.md): Done within the past 30 days, most
  // recently updated first, top 5
  const doneSql = `${getSelectSql()} WHERE ${statCol} = ? AND ${col("dateUpdated")} >= ?${filterClause} ${orderDateUpdatedDesc()} LIMIT 5`;
  const doneRows = await DbUtilsQuerySQL(doneSql, [
    "Done",
    thirtyDaysAgo,
    ...filterParams,
  ]);

  // One batched labels query for every row of every section
  const allRows = [...overdueRows, ...upcomingRows, ...noDateRows, ...doneRows];
  const labelsByTask = await getLabelsForTasks(allRows.map((r) => r.id as string));

  function toTask(row: Record<string, unknown>): NextViewTask {
    return {
      id: row.id as string,
      projectId: row.projectId as string,
      title: row.title as string,
      status: row.status as string,
      priority: row.priority as string,
      dueDate: row.dueDate as string | undefined,
      labels: labelsByTask.get(row.id as string) || [],
    };
  }

  return {
    overdue: overdueRows.map(toTask),
    upcoming: upcomingRows.map(toTask),
    noDate: noDateRows.map(toTask),
    recentlyDone: doneRows.map(toTask),
  };
}

async function getLabelsForTasks(ids: string[]): Promise<Map<string, string[]>> {
  const labelsByTask = new Map<string, string[]>();
  if (ids.length === 0) {
    return labelsByTask;
  }
  const rows = await DbUtilsQuerySQL(
    `SELECT ${col("taskId")}, name FROM task_labels WHERE ${col("taskId")} IN (${buildInPlaceholders(ids.length)})`,
    ids,
  );
  for (const row of rows) {
    const list = labelsByTask.get(row.taskId as string) || [];
    list.push(row.name as string);
    labelsByTask.set(row.taskId as string, list);
  }
  return labelsByTask;
}
