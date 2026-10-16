import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  dateCreated: string;
}

function col(name: string): string {
  return DbUtilsGetType() === "postgres" ? `"${name}"` : name;
}

export async function NotificationsDataAddSubscription(
  userId: string,
  endpoint: string,
  keys: PushSubscriptionKeys,
): Promise<void> {
  const dateCreated = new Date().toISOString();
  if (DbUtilsGetType() === "postgres") {
    await DbUtilsExecSQL(
      `INSERT INTO push_subscriptions ("userId", "endpoint", "keys", "dateCreated") VALUES (?, ?, ?, ?)
       ON CONFLICT ("endpoint") DO UPDATE SET "userId" = EXCLUDED."userId", "keys" = EXCLUDED."keys"`,
      [userId, endpoint, JSON.stringify(keys), dateCreated],
    );
  } else {
    await DbUtilsExecSQL(
      "INSERT OR REPLACE INTO push_subscriptions (userId, endpoint, keys, dateCreated) VALUES (?, ?, ?, ?)",
      [userId, endpoint, JSON.stringify(keys), dateCreated],
    );
  }
}

export async function NotificationsDataDeleteSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await DbUtilsExecSQL(
    `DELETE FROM push_subscriptions WHERE ${col("endpoint")} = ? AND ${col("userId")} = ?`,
    [endpoint, userId],
  );
}

export async function NotificationsDataDeleteSubscriptionByEndpoint(
  endpoint: string,
): Promise<void> {
  await DbUtilsExecSQL(
    `DELETE FROM push_subscriptions WHERE ${col("endpoint")} = ?`,
    [endpoint],
  );
}

export async function NotificationsDataListSubscriptions(): Promise<
  PushSubscriptionRecord[]
> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${col("userId")} AS "userId", ${col("endpoint")} AS "endpoint", ${col("keys")} AS "keys", ${col("dateCreated")} AS "dateCreated" FROM push_subscriptions`,
  );
  const subscriptions: PushSubscriptionRecord[] = [];
  for (const row of rows) {
    subscriptions.push({
      userId: row.userId as string,
      endpoint: row.endpoint as string,
      keys:
        typeof row.keys === "string"
          ? JSON.parse(row.keys)
          : (row.keys as PushSubscriptionKeys),
      dateCreated: row.dateCreated as string,
    });
  }
  return subscriptions;
}

/** Subscriptions of a single user, for targeted notifications (e.g. task updates). */
export async function NotificationsDataListSubscriptionsByUser(
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${col("userId")} AS "userId", ${col("endpoint")} AS "endpoint", ${col("keys")} AS "keys", ${col("dateCreated")} AS "dateCreated" FROM push_subscriptions WHERE ${col("userId")} = ?`,
    [userId],
  );
  const subscriptions: PushSubscriptionRecord[] = [];
  for (const row of rows) {
    subscriptions.push({
      userId: row.userId as string,
      endpoint: row.endpoint as string,
      keys:
        typeof row.keys === "string"
          ? JSON.parse(row.keys)
          : (row.keys as PushSubscriptionKeys),
      dateCreated: row.dateCreated as string,
    });
  }
  return subscriptions;
}

/**
 * Records that a notification was sent for a task/due date/kind.
 * Returns true if the entry was created by this call (first sender wins),
 * false if it already existed (notification already sent).
 */
export async function NotificationsDataLogSent(
  taskId: string,
  dueDate: string,
  kind: string,
): Promise<boolean> {
  let changes: number;
  if (DbUtilsGetType() === "postgres") {
    changes = await DbUtilsExecSQL(
      `INSERT INTO push_notifications_log ("taskId", "dueDate", "kind", "dateSent") VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [taskId, dueDate, kind, new Date().toISOString()],
    );
  } else {
    changes = await DbUtilsExecSQL(
      "INSERT OR IGNORE INTO push_notifications_log (taskId, dueDate, kind, dateSent) VALUES (?, ?, ?, ?)",
      [taskId, dueDate, kind, new Date().toISOString()],
    );
  }
  return changes > 0;
}

/** Assignee user ids per task id, for the given candidate tasks. */
export async function NotificationsDataListAssigneesByTaskIds(
  taskIds: string[],
): Promise<Map<string, string[]>> {
  const assigneesByTask = new Map<string, string[]>();
  if (taskIds.length === 0) {
    return assigneesByTask;
  }
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = await DbUtilsQuerySQL(
    `SELECT ${col("taskId")} AS "taskId", ${col("userId")} AS "userId" FROM task_assignees WHERE ${col("taskId")} IN (${placeholders})`,
    taskIds,
  );
  for (const row of rows) {
    const userIds = assigneesByTask.get(row.taskId as string) ?? [];
    userIds.push(row.userId as string);
    assigneesByTask.set(row.taskId as string, userIds);
  }
  return assigneesByTask;
}

/**
 * Ids of the projects a user can see: public projects and projects the user
 * is a member of (mirrors LIST_VISIBLE_PROJECTS in ProjectsData).
 */
export async function NotificationsDataListVisibleProjectIds(
  userId: string,
): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    `SELECT ${col("id")} AS "id" FROM projects WHERE ${col("visibility")} = 'public' OR ${col("id")} IN (SELECT ${col("projectId")} FROM project_users WHERE ${col("userId")} = ?)`,
    [userId],
  );
  return rows.map((row) => row.id as string);
}
