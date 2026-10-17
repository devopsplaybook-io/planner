import type { Task, TaskRecurrence, TaskDependency } from "../stores/tasks";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CANCELLED_SUFFIX = " [cancelled]";

/**
 * Human label of a recurrence rule: "Every day", "Every 3 days",
 * "Every week on Mon, Fri", "Every 2 weeks", "Every month",
 * "Every 3 months". Weekly rules with a weekday set repeat weekly
 * (the interval is not applied to them), so the label says "Every week".
 */
export function recurrenceLabel(rule: TaskRecurrence | null | undefined): string {
  if (!rule || !rule.frequency) {
    return "";
  }
  const every = rule.interval > 1 ? `Every ${rule.interval}` : "Every";
  if (rule.frequency === "weekly" && rule.weekdays && rule.weekdays.length > 0) {
    const days = [...rule.weekdays].sort((a, b) => a - b)
      .map((d) => WEEKDAY_NAMES[d] || "")
      .filter(Boolean);
    if (days.length > 0) {
      return `Every week on ${days.join(", ")}`;
    }
  }
  const unit =
    rule.interval > 1
      ? { daily: "days", weekly: "weeks", monthly: "months" }[rule.frequency]
      : { daily: "day", weekly: "week", monthly: "month" }[rule.frequency];
  return `${every} ${unit}`;
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
 * Client-side mirror of the server's computeNextDueDate
 * (planner-server/src/tasks/TaskRecurrence.ts): UTC date-part arithmetic over
 * "YYYY-MM-DD" due dates. Daily shifts by interval days; weekly by interval
 * weeks, or with a weekday set the next calendar day strictly after the due
 * date whose weekday is in the set (the interval is ignored for that case);
 * monthly the same day-of-month interval months later, clamped to the target
 * month's last day. Returns null when the rule or the due date is missing or
 * malformed.
 */
export function computeNextDueDate(
  rule: TaskRecurrence | null | undefined,
  currentDueDate?: string,
): string | null {
  if (!rule || !rule.frequency || !currentDueDate) {
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
  // monthly: clamp to the target month's last day (Jan 31 -> Feb 28/29)
  const target = new Date(Date.UTC(year, month - 1 + rule.interval, 1));
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return formatDateParts(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    Math.min(day, daysInTargetMonth),
  );
}

/** A dependency title with the trailing " [cancelled]" suffix stripped. */
function baseTitle(title?: string): string | undefined {
  return title && title.endsWith(CANCELLED_SUFFIX)
    ? title.slice(0, -CANCELLED_SUFFIX.length)
    : title;
}

/**
 * The dependency pointing at the previous occurrence of a recurring task:
 * every spawned occurrence depends on the completed one, and occurrences
 * share their base title (the " [cancelled]" suffix of a cancelled one is
 * ignored on both sides). Returns null for non-recurring tasks or when no
 * dependency matches.
 */
export function findPreviousOccurrence(
  task: Pick<Task, "recurrence" | "dependencies" | "title"> | null | undefined,
): TaskDependency | null {
  if (!task?.recurrence || !Array.isArray(task.dependencies)) {
    return null;
  }
  const title = baseTitle(task.title);
  for (const dep of task.dependencies) {
    if (dep.title && baseTitle(dep.title) === title) {
      return dep;
    }
  }
  return null;
}

/**
 * Board filter over the recurrence rule: "recurring" keeps the tasks with a
 * rule, "non-recurring" the rest, "all" passes the list through.
 */
export function applyRecurringFilter<TaskT extends { recurrence?: TaskRecurrence | null }>(
  tasks: TaskT[],
  mode: "all" | "recurring" | "non-recurring",
): TaskT[] {
  if (mode === "recurring") {
    return tasks.filter((t) => !!t.recurrence);
  }
  if (mode === "non-recurring") {
    return tasks.filter((t) => !t.recurrence);
  }
  return tasks;
}
