import * as fs from "fs-extra";
import * as path from "path";
import * as cron from "node-cron";
import webpush from "web-push";
import { Config } from "../Config";
import { Task } from "../model/Task";
import { DbUtilsGetType, DbUtilsQuerySQL } from "../utils/DbUtils";
import {
  NotificationsDataDeleteSubscriptionByEndpoint,
  NotificationsDataListSubscriptions,
  NotificationsDataListSubscriptionsByUser,
  NotificationsDataLogSent,
  type PushSubscriptionRecord,
} from "./NotificationsData";

const logger = console;

export type NotificationKind = "day-before" | "day-of";

let config: Config;
let vapidPublicKey = "";
let vapidPrivateKey = "";

// ── Public Interface ──────────────────────────────────────────────────────────

export async function NotificationsInit(configIn: Config): Promise<void> {
  config = configIn;

  if (!config.WEB_PUSH_ENABLED) {
    logger.info("[Notifications] Web push notifications disabled");
    return;
  }

  await resolveVapidKeys();
  webpush.setVapidDetails(
    config.WEB_PUSH_SUBJECT,
    vapidPublicKey,
    vapidPrivateKey,
  );

  validateTimezone(config.WEB_PUSH_TIMEZONE);

  logger.info(
    `[Notifications] Scheduling due date notifications: ${config.WEB_PUSH_SCHEDULE_CRON}`,
  );
  cron.schedule(config.WEB_PUSH_SCHEDULE_CRON, () => {
    NotificationsCheckAndSend().catch((err) =>
      logger.error(
        `[Notifications] Failed to send due date notifications: ${err.message}`,
      ),
    );
  });
}

export function NotificationsIsEnabled(): boolean {
  return !!config?.WEB_PUSH_ENABLED && !!vapidPublicKey;
}

export function NotificationsGetPublicKey(): string {
  return vapidPublicKey;
}

// ── Due date check ────────────────────────────────────────────────────────────

export async function NotificationsCheckAndSend(
  now: Date = new Date(),
): Promise<void> {
  if (!NotificationsIsEnabled()) {
    return;
  }
  if (now.getHours() < config.WEB_PUSH_NOTIFY_HOUR) {
    return;
  }

  const sql =
    DbUtilsGetType() === "postgres"
      ? 'SELECT id, title, status, "dueDate" FROM tasks WHERE "dueDate" IS NOT NULL'
      : "SELECT id, title, status, dueDate FROM tasks WHERE dueDate IS NOT NULL";
  const rows = await DbUtilsQuerySQL(sql);

  const subscriptions = await NotificationsDataListSubscriptions();
  if (subscriptions.length === 0) {
    // Nothing to claim either: reminders stay available until someone subscribes
    return;
  }

  for (const row of rows) {
    const kind = getTaskNotificationKind(
      row.dueDate as string,
      row.status as string,
      now,
      config.WEB_PUSH_NOTIFY_HOUR,
      config.WEB_PUSH_TIMEZONE,
    );
    if (!kind) {
      continue;
    }
    // First sender to log the entry wins; skips duplicates on later runs
    const claimed = await NotificationsDataLogSent(
      row.id as string,
      (row.dueDate as string).substring(0, 10),
      kind,
    );
    if (!claimed) {
      continue;
    }
    await sendToSubscriptions(
      subscriptions,
      row.id as string,
      row.title as string,
      kind,
    );
  }
}

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** Calendar parts (year/month/day/hour) of an instant, in the given timezone. */
function getZonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
    };
  }
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
  };
}

/** YYYY-MM-DD of the calendar day offset from the day of `date` in `timeZone`. */
export function getZonedDateKey(
  date: Date,
  timeZone: string,
  dayOffset: number,
): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  // Calendar arithmetic in UTC space stays correct across month, year and DST
  // boundaries, independently of the server timezone.
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return `${shifted.getUTCFullYear()}-${`${shifted.getUTCMonth() + 1}`.padStart(2, "0")}-${`${shifted.getUTCDate()}`.padStart(2, "0")}`;
}

/**
 * Decides which reminder (if any) should be sent for a task:
 * - "day-of" when the task is due today
 * - "day-before" when the task is due tomorrow
 * Notifications are only sent from WEB_PUSH_NOTIFY_HOUR onwards
 * and completed ("Done") tasks never trigger reminders.
 * "Today" and the hour are evaluated in WEB_PUSH_TIMEZONE (server timezone
 * when empty).
 */
export function getTaskNotificationKind(
  dueDate: string | null | undefined,
  status: string,
  now: Date,
  notifyHour: number,
  timezone = "",
): NotificationKind | null {
  if (!dueDate || status === "Done") {
    return null;
  }
  if (getZonedParts(now, timezone).hour < notifyHour) {
    return null;
  }
  const due = dueDate.substring(0, 10);
  if (due === getZonedDateKey(now, timezone, 0)) {
    return "day-of";
  }
  if (due === getZonedDateKey(now, timezone, 1)) {
    return "day-before";
  }
  return null;
}

/** Fails fast (and clearly) on an unusable WEB_PUSH_TIMEZONE instead of every tick. */
function validateTimezone(timezone: string): void {
  if (!timezone) {
    return;
  }
  try {
    getZonedParts(new Date(), timezone);
    logger.info(`[Notifications] Due dates evaluated in timezone ${timezone}`);
  } catch {
    logger.error(
      `[Notifications] Invalid WEB_PUSH_TIMEZONE "${timezone}", falling back to the server timezone`,
    );
    config.WEB_PUSH_TIMEZONE = "";
  }
}

// ── Task update notifications ─────────────────────────────────────────────

/**
 * Notifies the assignees of a task (except the acting user) that the task
 * was updated. Failures are logged, never propagated: a notification
 * problem must not fail the underlying task mutation.
 */
export async function NotificationsTaskUpdated(
  task: Task,
  actorUserId: string,
  actorName: string,
  summary: string,
): Promise<void> {
  if (!NotificationsIsEnabled() || !task) {
    return;
  }
  try {
    const assigneeIds = [
      ...new Set(
        (task.assignees || [])
          .map((a) => a.userId)
          .filter((id) => id && id !== actorUserId),
      ),
    ];
    if (assigneeIds.length === 0) {
      return;
    }
    const payload = JSON.stringify({
      title: `Task updated by ${actorName || "someone"}`,
      body: summary ? `${task.title} — ${summary}` : task.title,
      url: `/?taskId=${task.id}`,
      // Same tag replaces the previous update notification instead of stacking
      tag: `task-${task.id}-update`,
    });
    for (const userId of assigneeIds) {
      const subscriptions =
        await NotificationsDataListSubscriptionsByUser(userId);
      for (const subscription of subscriptions) {
        await sendPushToSubscription(subscription, payload);
      }
    }
  } catch (error) {
    logger.error(
      `[Notifications] Failed to send task update notifications: ${(error as Error).message}`,
    );
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * VAPID keys are read from the configuration when provided, then from a
 * previously generated file, and generated on first start otherwise.
 * Explicit keys keep subscriptions valid across reinstalls of the data volume
 * and when several instances share the same database.
 */
async function resolveVapidKeys(): Promise<void> {
  if (config.WEB_PUSH_VAPID_PUBLIC_KEY && config.WEB_PUSH_VAPID_PRIVATE_KEY) {
    vapidPublicKey = config.WEB_PUSH_VAPID_PUBLIC_KEY;
    vapidPrivateKey = config.WEB_PUSH_VAPID_PRIVATE_KEY;
    logger.info("[Notifications] Using VAPID keys from the configuration");
    return;
  }

  const keysFile = path.join(config.DATA_DIR, "vapid-keys.json");
  if (await fs.pathExists(keysFile)) {
    const keys = await fs.readJson(keysFile);
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    logger.info("[Notifications] Using VAPID keys from " + keysFile);
    return;
  }

  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  await fs.ensureDir(path.dirname(keysFile));
  await fs.writeJson(keysFile, keys);
  logger.info("[Notifications] Generated new VAPID keys in " + keysFile);
}

/** Sends a push payload to one subscription, cleaning it up when expired. */
async function sendPushToSubscription(
  subscription: PushSubscriptionRecord,
  payload: string,
): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      payload,
    );
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // Subscription expired or invalid: clean it up
      await NotificationsDataDeleteSubscriptionByEndpoint(
        subscription.endpoint,
      );
    }
    logger.error(
      `[Notifications] Push failed (status=${statusCode || "n/a"}): ${(error as Error).message}`,
    );
  }
}

async function sendToSubscriptions(
  subscriptions: PushSubscriptionRecord[],
  taskId: string,
  taskTitle: string,
  kind: NotificationKind,
): Promise<void> {
  const payload = JSON.stringify({
    title: kind === "day-of" ? "Task due today" : "Task due tomorrow",
    body: taskTitle,
    url: `/?taskId=${taskId}`,
    // Same tag replaces the previous reminder instead of stacking
    tag: `${taskId}-${kind}`,
  });
  for (const subscription of subscriptions) {
    await sendPushToSubscription(subscription, payload);
  }
}
