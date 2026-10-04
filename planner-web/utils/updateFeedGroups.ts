import { formatLocalDate } from "./date";
import type { UpdateFeedEntry } from "../stores/tasks";

export interface UpdateFeedDayGroup {
  /** Local calendar day of the group, "YYYY-MM-DD" (formatLocalDate). */
  key: string;
  /** "Today", "Yesterday", or the full localized date of the day. */
  label: string;
  entries: UpdateFeedEntry[];
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
 * Groups feed entries (newest-first from the server) per local calendar day:
 * a new group starts whenever the day of entry.dateCreated changes. Entries
 * from one day that straddle a page boundary merge naturally because the
 * page calls this on the accumulated flat list.
 */
export function groupEntriesByDay(
  entries: UpdateFeedEntry[],
  now: Date = new Date(),
): UpdateFeedDayGroup[] {
  const groups: UpdateFeedDayGroup[] = [];
  for (const entry of entries) {
    const date = new Date(entry.dateCreated);
    if (Number.isNaN(date.getTime())) continue;
    const key = formatLocalDate(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, label: formatDayGroupLabel(key, now), entries: [entry] });
    }
  }
  return groups;
}
