import { Task, TaskRecurrence } from "../model/Task";

export const RECURRENCE_ERROR =
  "Invalid: recurrence (must be an object with frequency \"daily\" | \"weekly\" | \"monthly\", an interval between 1 and 999, optional weekdays 0-6 and, for monthly rules, an optional monthDay 1-31)";

/**
 * Validates a recurrence rule payload. Returns the normalized rule (with a
 * copy of the weekdays) or an error message. Pure so routes can answer 400
 * without touching the database.
 */
export function parseRecurrence(value: unknown): {
  recurrence?: TaskRecurrence;
  error?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: RECURRENCE_ERROR };
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.frequency !== "daily" &&
    raw.frequency !== "weekly" &&
    raw.frequency !== "monthly"
  ) {
    return { error: RECURRENCE_ERROR };
  }
  if (
    !Number.isInteger(raw.interval) ||
    (raw.interval as number) < 1 ||
    (raw.interval as number) > 999
  ) {
    return { error: RECURRENCE_ERROR };
  }
  let weekdays: number[] | undefined;
  if (raw.weekdays !== undefined && raw.weekdays !== null) {
    if (
      !Array.isArray(raw.weekdays) ||
      (raw.weekdays as unknown[]).some(
        (d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6,
      )
    ) {
      return { error: RECURRENCE_ERROR };
    }
    weekdays = [...new Set(raw.weekdays as number[])];
  }
  let monthDay: number | undefined;
  if (raw.monthDay !== undefined && raw.monthDay !== null) {
    if (
      !Number.isInteger(raw.monthDay) ||
      (raw.monthDay as number) < 1 ||
      (raw.monthDay as number) > 31
    ) {
      return { error: RECURRENCE_ERROR };
    }
    monthDay = raw.monthDay as number;
  }
  const recurrence: TaskRecurrence = {
    frequency: raw.frequency,
    interval: raw.interval as number,
  };
  if (weekdays && weekdays.length > 0) {
    recurrence.weekdays = weekdays;
  }
  if (monthDay !== undefined && raw.frequency === "monthly") {
    recurrence.monthDay = monthDay;
  }
  return { recurrence };
}

/** Parses a "YYYY-MM-DD" date part; returns null when malformed. */
function parseDateParts(dueDate: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatDateParts(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Computes the due date of the next occurrence from the current one, in UTC
 * date-part arithmetic (due dates carry no time of day):
 * - daily: current + interval days
 * - weekly without a weekday set: current + interval × 7 days
 * - weekly with a weekday set: the next calendar day strictly after the
 *   current due date whose weekday is in the set (the interval is ignored
 *   for this case — documented v1 simplification)
 * - monthly: same day-of-month, interval months later, clamped to the
 *   target month's last day; when the rule carries a monthDay (1–31) it is
 *   used as the day instead of the due date's own day (stable across
 *   rescheduled occurrences), clamped the same way
 * Returns null when the due date is missing or malformed.
 */
export function computeNextDueDate(
  rule: TaskRecurrence,
  currentDueDate?: string,
): string | null {
  if (!currentDueDate) {
    return null;
  }
  const parts = parseDateParts(currentDueDate);
  if (!parts) {
    return null;
  }
  const { year, month, day } = parts;
  if (rule.frequency === "daily") {
    const next = new Date(Date.UTC(year, month - 1, day + rule.interval));
    return formatDateParts(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
    );
  }
  if (rule.frequency === "weekly") {
    if (!rule.weekdays || rule.weekdays.length === 0) {
      const next = new Date(
        Date.UTC(year, month - 1, day + rule.interval * 7),
      );
      return formatDateParts(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
      );
    }
    const weekdays = new Set(rule.weekdays);
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(Date.UTC(year, month - 1, day + offset));
      if (weekdays.has(candidate.getUTCDay())) {
        return formatDateParts(
          candidate.getUTCFullYear(),
          candidate.getUTCMonth() + 1,
          candidate.getUTCDate(),
        );
      }
    }
    return null;
  }
  // monthly: clamp to the target month's last day (Jan 31 -> Feb 28/29);
  // an explicit monthDay pins the day independently of the due date
  const anchorDay = rule.monthDay ?? day;
  const target = new Date(Date.UTC(year, month - 1 + rule.interval, 1));
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return formatDateParts(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    Math.min(anchorDay, daysInTargetMonth),
  );
}

/**
 * Builds the next occurrence of a completed recurring task, following the
 * clone semantics: the title (with a trailing " [cancelled]" suffix
 * stripped), description, checklist (every item's done state reset),
 * priority, labels, assignees and the recurrence rule are carried over;
 * comments, attachments and dependencies are not. The status is the
 * project's first status (resolved by the caller; without it the completed
 * task's status is kept) and the due date is the shifted one.
 */
export function buildNextOccurrence(completed: Task, firstStatus?: string): Task {
  const next = new Task();
  next.projectId = completed.projectId;
  const suffix = " [cancelled]";
  next.title = completed.title.endsWith(suffix)
    ? completed.title.slice(0, -suffix.length)
    : completed.title;
  next.description = completed.description;
  next.status = firstStatus || completed.status;
  next.priority = completed.priority;
  next.labels = [...(completed.labels || [])];
  next.assignees = (completed.assignees || []).map((a) => ({ userId: a.userId }));
  next.checklist = (completed.checklist || []).map((item) => ({
    text: item.text,
    done: false,
  }));
  if (completed.recurrence) {
    next.recurrence = { ...completed.recurrence };
    if (completed.recurrence.weekdays) {
      next.recurrence.weekdays = [...completed.recurrence.weekdays];
    }
  }
  next.dueDate = computeNextDueDate(completed.recurrence, completed.dueDate) || undefined;
  return next;
}
