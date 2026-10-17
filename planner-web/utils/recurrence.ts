import type { TaskRecurrence } from "../stores/tasks";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** English ordinal of a day number: 1st, 2nd, 3rd, 4th, … 11th–13th, 21st… */
export function monthDayOrdinal(day: number): string {
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * Human label of a recurrence rule: "Every day", "Every 3 days",
 * "Every week on Mon, Fri", "Every 2 weeks", "Every month",
 * "Every 3 months", "Every month on the 15th" and
 * "Every 2 months on the 15th" for a monthly rule with a chosen day.
 * Weekly rules with a weekday set repeat weekly (the interval is not
 * applied to them), so the label says "Every week".
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
  if (rule.frequency === "monthly" && rule.monthDay) {
    return `${every} month${rule.interval > 1 ? "s" : ""} on the ${monthDayOrdinal(rule.monthDay)}`;
  }
  const unit =
    rule.interval > 1
      ? { daily: "days", weekly: "weeks", monthly: "months" }[rule.frequency]
      : { daily: "day", weekly: "week", monthly: "month" }[rule.frequency];
  return `${every} ${unit}`;
}
