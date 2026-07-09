import { DbUtilsQuerySQL, DbUtilsGetType } from "../utils/DbUtils";

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
  labels?: string[];
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

function orderDateCreatedDesc(): string {
  return `ORDER BY ${col("dateCreated")} DESC`;
}

export async function ViewsDataGetDashboard(
  filters?: DashboardFilters,
): Promise<NextViewData> {
  const now = new Date().toISOString();
  const in1Month = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
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

  if (filters?.labels && filters.labels.length > 0) {
    const placeholders = filters.labels.map(() => "?").join(", ");
    filterConditions.push(
      `id IN (SELECT ${col("taskId")} FROM task_labels WHERE name IN (${placeholders}))`,
    );
    filterParams.push(...filters.labels);
  }

  const filterClause =
    filterConditions.length > 0 ? ` AND ${filterConditions.join(" AND ")}` : "";

  // Overdue: dueDate IS NOT NULL AND dueDate < now AND status != 'Done'
  const overdueSql = `${getSelectSql()} WHERE ${dueCol} IS NOT NULL AND ${dueCol} < ? AND ${statCol} != ?${filterClause} ${orderDueDateAsc()}`;
  const overdueRows = await DbUtilsQuerySQL(overdueSql, [
    now,
    "Done",
    ...filterParams,
  ]);

  // Upcoming (1 month): dueDate >= now AND dueDate <= now+1month AND status != 'Done'
  const upcomingSql = `${getSelectSql()} WHERE ${dueCol} IS NOT NULL AND ${dueCol} >= ? AND ${dueCol} <= ? AND ${statCol} != ?${filterClause} ${orderDueDateAsc()}`;
  const upcomingRows = await DbUtilsQuerySQL(upcomingSql, [
    now,
    in1Month,
    "Done",
    ...filterParams,
  ]);

  // No date, ordered by priority: dueDate IS NULL AND status != 'Done'
  const noDateSql = `${getSelectSql()} WHERE ${dueCol} IS NULL AND ${statCol} != ?${filterClause} ${orderPriorityAsc()}`;
  const noDateRows = await DbUtilsQuerySQL(noDateSql, [
    "Done",
    ...filterParams,
  ]);

  // Last 5 completed: status = 'Done', ordered by dateUpdated DESC
  const doneSql = `${getSelectSql()} WHERE ${statCol} = ?${filterClause} ${orderDateCreatedDesc()} LIMIT 5`;
  const doneRows = await DbUtilsQuerySQL(doneSql, ["Done", ...filterParams]);

  async function enrichTaskRow(
    row: Record<string, unknown>,
  ): Promise<NextViewTask> {
    const labels: string[] = [];
    const labelRows = await DbUtilsQuerySQL(
      DbUtilsGetType() === "postgres"
        ? 'SELECT name FROM task_labels WHERE "taskId" = ?'
        : "SELECT name FROM task_labels WHERE taskId = ?",
      [row.id],
    );
    for (const lr of labelRows) {
      labels.push(lr.name as string);
    }
    return {
      id: row.id as string,
      projectId: row.projectId as string,
      title: row.title as string,
      status: row.status as string,
      priority: row.priority as string,
      dueDate: row.dueDate as string | undefined,
      labels,
    };
  }

  const overdue = await Promise.all(overdueRows.map(enrichTaskRow));
  const upcoming = await Promise.all(upcomingRows.map(enrichTaskRow));
  const noDate = await Promise.all(noDateRows.map(enrichTaskRow));
  const recentlyDone = await Promise.all(doneRows.map(enrichTaskRow));

  return { overdue, upcoming, noDate, recentlyDone };
}
