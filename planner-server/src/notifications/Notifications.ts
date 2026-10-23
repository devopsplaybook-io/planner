import * as fs from "fs-extra";
import * as path from "path";
import * as cron from "node-cron";
import webpush from "web-push";
import { Config } from "../Config";
import { Task } from "../model/Task";
import { DbUtilsGetType, DbUtilsQuerySQL } from "../utils/DbUtils";
import { UsersDataList, UsersDataListNotificationDigestOptIn } from "../users/UsersData";
import {
  NotificationsDataDeleteSubscriptionByEndpoint,
  NotificationsDataListAssigneesByTaskIds,
  NotificationsDataListSubscriptions,
  NotificationsDataListSubscriptionsByUser,
  NotificationsDataListVisibleProjectIds,
  NotificationsDataLogSent,
  type PushSubscriptionRecord,
} from "./NotificationsData";

const logger = console;

export type NotificationKind = "day-before" | "day-of" | "overdue";

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

/** Reminder candidates: due before local midnight of the day after tomorrow. */
export function buildReminderTasksQuery(
  now: Date,
  timezone: string,
  dbType: "sqlite" | "postgres" = DbUtilsGetType(),
): { sql: string; params: unknown[] } {
  const quote = (name: string) =>
    dbType === "postgres" ? `"${name}"` : name;
  const endExclusive = getZonedDateKey(now, timezone, 2);
  return {
    sql:
      `SELECT id, title, status, ${quote("dueDate")}, ${quote("projectId")} FROM tasks` +
      ` WHERE ${quote("dueDate")} IS NOT NULL AND ${quote("dueDate")} < ? AND ${quote("status")} != ?`,
    params: [endExclusive, "Done"],
  };
}

let checkAndSendInFlight = false;

export async function NotificationsCheckAndSend(
  now: Date = new Date(),
): Promise<void> {
  if (!NotificationsIsEnabled()) {
    return;
  }
  if (now.getHours() < config.WEB_PUSH_NOTIFY_HOUR) {
    return;
  }
  if (checkAndSendInFlight) {
    logger.info("[Notifications] Skipping overlapping reminder run");
    return;
  }
  checkAndSendInFlight = true;
  try {
    await runCheckAndSend(now);
  } finally {
    checkAndSendInFlight = false;
  }
}

async function runCheckAndSend(now: Date): Promise<void> {
  const { sql, params } = buildReminderTasksQuery(
    now,
    config.WEB_PUSH_TIMEZONE,
  );
  const rows = await DbUtilsQuerySQL(sql, params);

  const subscriptions = await NotificationsDataListSubscriptions();
  if (subscriptions.length === 0) {
    // Nothing to claim either: reminders stay available until someone subscribes
    return;
  }
  const subscriptionsByUser = new Map<string, PushSubscriptionRecord[]>();
  for (const subscription of subscriptions) {
    const list = subscriptionsByUser.get(subscription.userId) ?? [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.userId, list);
  }

  const digestOptedIn = new Set(await UsersDataListNotificationDigestOptIn());
  const assigneesByTask = await NotificationsDataListAssigneesByTaskIds(
    rows.map((row) => row.id as string),
  );
  const canSeeProject = await buildProjectVisibilityChecker(
    [...assigneesByTask.values()].flat(),
  );

  const digestEntries = new Map<string, ReminderEntry[]>();

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
    // Personal reminders: only the assignees who can see the task's project
    const recipients = getRecipientsForTask(
      assigneesByTask.get(row.id as string) ?? [],
      (userId) => canSeeProject(userId, row.projectId as string),
    );
    if (recipients.length === 0) {
      continue;
    }
    // First sender to log the entry wins; skips duplicates on later runs
    const claimed = await NotificationsDataLogSent(
      row.id as string,
      (row.dueDate as string).substring(0, 10),
      getClaimKind(kind, now),
    );
    if (!claimed) {
      continue;
    }
    for (const userId of recipients) {
      if (digestOptedIn.has(userId)) {
        const entries = digestEntries.get(userId) ?? [];
        entries.push({ title: row.title as string, kind });
        digestEntries.set(userId, entries);
      } else {
        const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
        await sendToSubscriptions(
          userSubscriptions,
          row.id as string,
          row.title as string,
          kind,
        );
      }
    }
  }

  // One consolidated push per digest user for this run
  for (const [userId, entries] of digestEntries) {
    const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
    if (userSubscriptions.length === 0) {
      continue;
    }
    const payload = JSON.stringify(
      buildDigestPayload(
        entries,
        getZonedDateKey(now, config.WEB_PUSH_TIMEZONE, 0),
      ),
    );
    for (const subscription of userSubscriptions) {
      await sendPushToSubscription(subscription, payload);
    }
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
 * - "overdue" when the task is past its due date
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
  const today = getZonedDateKey(now, timezone, 0);
  if (due === today) {
    return "day-of";
  }
  if (due === getZonedDateKey(now, timezone, 1)) {
    return "day-before";
  }
  // YYYY-MM-DD strings compare chronologically
  if (due < today) {
    return "overdue";
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

/** One reminder of a digest push. */
export interface ReminderEntry {
  title: string;
  kind: NotificationKind;
}

/** Reminder of a task goes to its assignees only; unassigned tasks remind nobody. */
export function getRecipientsForTask(
  assigneeIds: string[],
  canSeeProject: (userId: string) => boolean,
): string[] {
  return [...new Set(assigneeIds)].filter(canSeeProject);
}

const DIGEST_KIND_ORDER: NotificationKind[] = [
  "overdue",
  "day-of",
  "day-before",
];

const DIGEST_KIND_LABELS: Record<NotificationKind, string> = {
  overdue: "Overdue",
  "day-of": "Due today",
  "day-before": "Due tomorrow",
};

/** One consolidated push listing the run's reminders, grouped by kind. */
export function buildDigestPayload(
  entries: ReminderEntry[],
  dayKey: string,
): { title: string; body: string; url: string; tag: string } {
  const sections: string[] = [];
  for (const kind of DIGEST_KIND_ORDER) {
    const titles = entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => entry.title);
    if (titles.length > 0) {
      sections.push(`${DIGEST_KIND_LABELS[kind]}: ${titles.join(", ")}`);
    }
  }
  return {
    title: "Your task reminders",
    body: sections.join(" — "),
    url: "/",
    tag: `task-digest-${dayKey}`,
  };
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
    const canSeeProject = await buildProjectVisibilityChecker(assigneeIds);
    const recipients = getRecipientsForTask(assigneeIds, (userId) =>
      canSeeProject(userId, task.projectId),
    );
    if (recipients.length === 0) {
      return;
    }
    const payload = JSON.stringify({
      title: `Task updated by ${actorName || "someone"}`,
      body: summary ? `${task.title} — ${summary}` : task.title,
      url: `/?taskId=${task.id}`,
      // Same tag replaces the previous update notification instead of stacking
      tag: `task-${task.id}-update`,
    });
    for (const userId of recipients) {
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
 * Per-run project visibility for the given users: admins bypass the filter,
 * every other user gets the projects they can see resolved once up front.
 */
async function buildProjectVisibilityChecker(
  userIds: Iterable<string>,
): Promise<(userId: string, projectId: string) => boolean> {
  const adminIds = await getAdminIds();
  const visibleProjectsByUser = new Map<string, Set<string>>();
  for (const userId of new Set(userIds)) {
    if (!adminIds.has(userId)) {
      visibleProjectsByUser.set(
        userId,
        new Set(await NotificationsDataListVisibleProjectIds(userId)),
      );
    }
  }
  return createProjectVisibilityChecker(adminIds, visibleProjectsByUser);
}

/**
 * Per-run project visibility, mirroring ProjectVisibility.isProjectVisible:
 * admins see every project, other users only the projects they can see
 * (resolved once per user by the caller and passed in here).
 */
function createProjectVisibilityChecker(
  adminIds: Set<string>,
  visibleProjectsByUser: Map<string, Set<string>>,
): (userId: string, projectId: string) => boolean {
  return (userId, projectId) => {
    if (adminIds.has(userId)) {
      return true;
    }
    return visibleProjectsByUser.get(userId)?.has(projectId) ?? false;
  };
}

/** Ids of the admin users, for the visibility checker. */
function getAdminIds(): Promise<Set<string>> {
  return UsersDataList().then((users) => {
    return new Set(
      users.filter((user) => user.role === "admin").map((user) => user.id),
    );
  });
}

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

const KIND_TITLES: Record<NotificationKind, string> = {
  "day-of": "Task due today",
  "day-before": "Task due tomorrow",
  overdue: "Task overdue",
};

/**
 * Dedup key inside push_notifications_log. "overdue" repeats every day for
 * the same due date, so it is claimed per send day ("overdue-YYYY-MM-DD",
 * 18 chars) instead of once ever.
 */
function getClaimKind(kind: NotificationKind, now: Date): string {
  return kind === "overdue"
    ? `overdue-${getZonedDateKey(now, config.WEB_PUSH_TIMEZONE, 0)}`
    : kind;
}

async function sendToSubscriptions(
  subscriptions: PushSubscriptionRecord[],
  taskId: string,
  taskTitle: string,
  kind: NotificationKind,
): Promise<void> {
  const payload = JSON.stringify({
    title: KIND_TITLES[kind],
    body: taskTitle,
    url: `/?taskId=${taskId}`,
    // Same tag replaces the previous reminder instead of stacking
    tag: `${taskId}-${kind}`,
  });
  for (const subscription of subscriptions) {
    await sendPushToSubscription(subscription, payload);
  }
}
