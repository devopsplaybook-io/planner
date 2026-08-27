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
