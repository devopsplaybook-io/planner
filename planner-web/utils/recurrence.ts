import type { TaskRecurrence } from "../stores/tasks";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
