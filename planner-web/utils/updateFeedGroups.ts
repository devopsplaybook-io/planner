import { formatLocalDate } from "./date";
import { formatRelativeTime } from "./relativeTime";
import type { UpdateFeedEntry } from "../stores/tasks";

export interface UpdateFeedEntryGroup {
  /** id of the first (newest) entry of the group: stable key for rendering. */
  key: string;
  taskId: string;
  taskTitle: string;
  actorName: string | null;
  status?: string;
  projectId?: string;
  /** dateCreated of the first (newest) entry: the time shown on the card. */
  dateCreated: string;
  /** Entries of the group, in feed order (newest first). */
  entries: UpdateFeedEntry[];
}

export interface UpdateFeedDayGroup {
  /** Local calendar day of the group, "YYYY-MM-DD" (formatLocalDate). */
  key: string;
  /** "Today", "Yesterday", or the full localized date of the day. */
  label: string;
  /** Consecutive-update groups within the day, in feed order. */
  updateGroups: UpdateFeedEntryGroup[];
}

/**
 * "Today" / "Yesterday" relative to `now` (injectable for tests), otherwise
 * the full localized date (e.g. "Friday, October 2, 2026").
 */
export function formatDayGroupLabel(dayKey: string, now: Date = new Date()): string {
  if (dayKey === formatLocalDate(now)) {
    return "Today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey === formatLocalDate(yesterday)) {
    return "Yesterday";
  }
  // The key is local YYYY-MM-DD: build the date at local noon so a UTC
  // conversion can never shift it to the previous day
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  const date = new Date(year, month - 1, day, 12);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Collapses consecutive entries made by the same user on the same task at
 * the same displayed relative time into one group (one feed card listing
 * each change summary). Only adjacent entries merge: an entry by another
 * user or on another task in between starts a new group, so the feed
 * sequence is preserved.
 */
export function groupConsecutiveUpdates(
  entries: UpdateFeedEntry[],
  now: Date = new Date(),
): UpdateFeedEntryGroup[] {
  const groups: UpdateFeedEntryGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    const sameUpdate =
      last !== undefined &&
      last.taskId === entry.taskId &&
      last.actorName === entry.actorName &&
      formatRelativeTime(last.dateCreated, now) ===
        formatRelativeTime(entry.dateCreated, now);
    if (sameUpdate && last) {
      last.entries.push(entry);
    } else {
      groups.push({
        key: entry.id,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        actorName: entry.actorName,
        status: entry.status,
        projectId: entry.projectId,
        dateCreated: entry.dateCreated,
        entries: [entry],
      });
    }
  }
  return groups;
}

/**
 * Groups feed entries (newest-first from the server) per local calendar day:
 * a new group starts whenever the day of entry.dateCreated changes. Entries
 * from one day that straddle a page boundary merge naturally because the
 * page calls this on the accumulated flat list. Within a day, consecutive
 * same-user/same-task/same-displayed-time entries are collapsed into one
 * update group (grouping never crosses a day header).
 */
export function groupEntriesByDay(
  entries: UpdateFeedEntry[],
  now: Date = new Date(),
): UpdateFeedDayGroup[] {
  const days: { key: string; label: string; entries: UpdateFeedEntry[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.dateCreated);
    if (Number.isNaN(date.getTime())) continue;
    const key = formatLocalDate(date);
    const last = days[days.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      days.push({ key, label: formatDayGroupLabel(key, now), entries: [entry] });
    }
  }
  return days.map((day) => ({
    key: day.key,
    label: day.label,
    updateGroups: groupConsecutiveUpdates(day.entries, now),
  }));
}
