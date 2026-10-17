/**
 * Pure RFC 5545 ICS builder for the subscribable calendar feed. Framework
 * and database free so it can be unit-tested in isolation.
 */

export interface CalendarFeedEntry {
  id: string;
  title: string;
  description?: string;
  /** Name of the project the task belongs to (hierarchy encoded in the name). */
  projectName?: string;
  /** Date-only due date, `YYYY-MM-DD`. */
  dueDate: string;
}

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

/**
 * Escapes a text value for an ICS content line: backslash, semicolon and
 * comma are prefixed with a backslash; newlines become the literal `\n`.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds a content line so no physical line exceeds 75 octets: continuation
 * lines begin with a single space, which counts towards their octet budget.
 * Folding is octet-aware so multi-byte UTF-8 characters are never split.
 */
export function foldIcsLine(line: string): string {
  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;
  let maxOctets = MAX_LINE_OCTETS;
  for (const char of line) {
    const charOctets = Buffer.byteLength(char, "utf8");
    if (currentOctets + charOctets > maxOctets) {
      segments.push(current);
      current = "";
      currentOctets = 0;
      // The joining space occupies one of the continuation line's octets.
      maxOctets = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += charOctets;
  }
  segments.push(current);
  return segments.join(CRLF + " ");
}

/**
 * Parses the leading `YYYY-MM-DD` of a date-only value into a UTC midnight
 * Date. Returns null when the value does not start with a valid calendar
 * date (the entry is then skipped by the caller).
 */
export function parseIcsDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!match) {
    return null;
  }
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return isNaN(date.getTime()) ? null : date;
}

function formatIcsDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function formatIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Builds a complete VCALENDAR document from task entries. Entries with an
 * unparseable due date are skipped. Each event is an all-day event
 * (DTEND = due date + 1 day, exclusive per RFC 5545) with a stable UID so
 * calendar clients update existing events in place.
 */
export function buildTasksIcs(
  entries: CalendarFeedEntry[],
  generatedAt: Date,
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//planner//planner//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Planner",
  ];
  const dtStamp = formatIcsDateTime(generatedAt);
  for (const entry of entries) {
    const start = parseIcsDate(entry.dueDate);
    if (!start) {
      continue;
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${entry.id}@planner`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(end)}`);
    lines.push(
      `SUMMARY:${escapeIcsText(`${entry.projectName || "Planner"} / ${entry.title}`)}`,
    );
    if (entry.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(entry.description)}`);
    }
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
