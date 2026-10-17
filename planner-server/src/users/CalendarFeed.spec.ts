import {
  buildTasksIcs,
  escapeIcsText,
  foldIcsLine,
  parseIcsDate,
} from "./CalendarFeed";
import { CalendarFeedEntry } from "./CalendarFeed";

function makeEntry(overrides: Partial<CalendarFeedEntry> = {}): CalendarFeedEntry {
  return {
    id: "task-1",
    title: "Task title",
    description: "",
    projectName: "Home",
    dueDate: "2026-10-17",
    ...overrides,
  };
}

function unfold(ics: string): string {
  // Reverse the folding (continuation lines start with a space) so single
  // properties can be matched with plain string equality.
  return ics.replace(/\r\n /g, "");
}

describe("escapeIcsText", () => {
  it("should escape backslash, semicolon and comma", () => {
    expect(escapeIcsText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
  });

  it("should escape newlines as literal \\n", () => {
    expect(escapeIcsText("line1\nline2\r\nline3\rline4")).toBe(
      "line1\\nline2\\nline3\\nline4",
    );
  });
});

describe("foldIcsLine", () => {
  it("should keep short lines unfolded", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("should fold long ASCII lines with a space continuation", () => {
    const line = `SUMMARY:${"a".repeat(120)}`;
    const folded = foldIcsLine(line);
    const physicalLines = folded.split("\r\n");
    expect(physicalLines.length).toBe(2);
    for (const physical of physicalLines) {
      expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("should fold without splitting multi-byte characters", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldIcsLine(line);
    for (const physical of folded.split("\r\n")) {
      expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("parseIcsDate", () => {
  it("should parse the leading YYYY-MM-DD of a date string", () => {
    expect(parseIcsDate("2026-10-17T12:00:00.000Z")).toEqual(
      new Date(Date.UTC(2026, 9, 17)),
    );
  });

  it("should reject values without a valid leading date", () => {
    expect(parseIcsDate("")).toBeNull();
    expect(parseIcsDate("not-a-date")).toBeNull();
  });
});

describe("buildTasksIcs", () => {
  const generatedAt = new Date(Date.UTC(2026, 9, 17, 8, 30, 0));

  it("should emit the VCALENDAR header and footer", () => {
    const ics = buildTasksIcs([], generatedAt);
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//planner//planner//EN\r\n");
    expect(ics).toContain("CALSCALE:GREGORIAN\r\n");
    expect(ics).toContain("X-WR-CALNAME:Planner\r\n");
    expect(ics).toContain("END:VCALENDAR\r\n");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("should use CRLF line endings only", () => {
    const ics = buildTasksIcs([makeEntry()], generatedAt);
    expect(ics).not.toMatch(/(^|[^\r])\n/);
  });

  it("should build an all-day event with UID and DTSTAMP", () => {
    const ics = buildTasksIcs([makeEntry()], generatedAt);
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:task-1@planner\r\n");
    expect(ics).toContain("DTSTAMP:20261017T083000Z\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261017\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261018\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).toContain("END:VEVENT\r\n");
  });

  it("should carry the project path and task title in SUMMARY", () => {
    const ics = buildTasksIcs(
      [makeEntry({ projectName: "Home/Parents", title: "School forms" })],
      generatedAt,
    );
    expect(ics).toContain("SUMMARY:Home/Parents / School forms\r\n");
  });

  it("should fall back to Planner when the project name is missing", () => {
    const ics = buildTasksIcs([makeEntry({ projectName: undefined })], generatedAt);
    expect(ics).toContain("SUMMARY:Planner / Task title\r\n");
  });

  it("should escape summary and description text", () => {
    const ics = buildTasksIcs(
      [
        makeEntry({
          title: "buy; milk, 2\\3",
          description: "first\nsecond",
        }),
      ],
      generatedAt,
    );
    expect(ics).toContain("SUMMARY:Home / buy\\; milk\\, 2\\\\3\r\n");
    expect(ics).toContain("DESCRIPTION:first\\nsecond\r\n");
  });

  it("should roll the DTEND over month and year boundaries", () => {
    const ics = buildTasksIcs(
      [
        makeEntry({ id: "task-month", dueDate: "2026-01-31" }),
        makeEntry({ id: "task-year", dueDate: "2026-12-31" }),
      ],
      generatedAt,
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260131\r\nDTEND;VALUE=DATE:20260201");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
  });

  it("should skip entries with an unparseable due date", () => {
    const ics = buildTasksIcs(
      [makeEntry({ id: "task-bad", dueDate: "soon" }), makeEntry()],
      generatedAt,
    );
    expect(unfold(ics)).not.toContain("UID:task-bad@planner");
    expect(unfold(ics)).toContain("UID:task-1@planner");
  });
});
