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
  highPriority: NextViewTask[];
}

const SQL_NEXT_OVERDUE: Record<string, string> = {
  postgres: `SELECT id, "projectId", title, status, priority, "dueDate" FROM tasks WHERE "dueDate" IS NOT NULL AND "dueDate" < $1 AND status != $2 ORDER BY "dueDate" ASC, priority ASC`,
  sqlite:
    "SELECT id, projectId, title, status, priority, dueDate FROM tasks WHERE dueDate IS NOT NULL AND dueDate < ? AND status != ? ORDER BY dueDate ASC, priority ASC",
};

const SQL_NEXT_UPCOMING: Record<string, string> = {
  postgres: `SELECT id, "projectId", title, status, priority, "dueDate" FROM tasks WHERE "dueDate" IS NOT NULL AND "dueDate" >= $1 AND "dueDate" <= $2 AND status != $3 ORDER BY "dueDate" ASC, priority ASC`,
  sqlite:
    "SELECT id, projectId, title, status, priority, dueDate FROM tasks WHERE dueDate IS NOT NULL AND dueDate >= ? AND dueDate <= ? AND status != ? ORDER BY dueDate ASC, priority ASC",
};

const SQL_NEXT_HIGH_PRIORITY: Record<string, string> = {
  postgres: `SELECT id, "projectId", title, status, priority, "dueDate" FROM tasks WHERE priority = $1 AND status != $2 AND "dueDate" IS NULL ORDER BY priority ASC`,
  sqlite:
    "SELECT id, projectId, title, status, priority, dueDate FROM tasks WHERE priority = ? AND status != ? AND dueDate IS NULL ORDER BY priority ASC",
};

async function enrichTaskRow(
  row: Record<string, unknown>,
): Promise<NextViewTask> {
  const labels: string[] = [];
  const labelRows = await DbUtilsQuerySQL(
    DbUtilsGetType() === "postgres"
      ? 'SELECT name FROM task_labels WHERE "taskId" = $1'
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

export async function ViewsDataGetNextTasks(): Promise<NextViewData> {
  const now = new Date().toISOString();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const overdueRows = await DbUtilsQuerySQL(
    SQL_NEXT_OVERDUE[DbUtilsGetType()],
    [now, "Done"],
  );
  const upcomingRows = await DbUtilsQuerySQL(
    SQL_NEXT_UPCOMING[DbUtilsGetType()],
    [now, in3Days, "Done"],
  );
  const highPriorityRows = await DbUtilsQuerySQL(
    SQL_NEXT_HIGH_PRIORITY[DbUtilsGetType()],
    ["high", "Done"],
  );

  const overdue = await Promise.all(overdueRows.map(enrichTaskRow));
  const upcoming = await Promise.all(upcomingRows.map(enrichTaskRow));
  const highPriority = await Promise.all(highPriorityRows.map(enrichTaskRow));

  return { overdue, upcoming, highPriority };
}
