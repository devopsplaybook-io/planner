/**
 * Pure helpers for the Task Templates UI, mirroring the server behavior
 * (planner-server/src/tasktemplates/TaskTemplatesInstance.ts) so the dialog
 * can preview what an instance will look like without a round-trip.
 */

/**
 * "YYYY.MN.DD" title suffix of instances created from a template when
 * "add the day date to the title" is enabled: zero-padded month and day of
 * the creation date (e.g. "2026.10.17").
 */
export function buildDatedTitle(title: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${title} ${year}.${month}.${day}`;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Human label for the cron schedules the app generates (daily, specific
 * weekdays, day-of-month) at midnight. Unknown shapes fall back to the raw
 * expression so nothing silently misrepresents a hand-written cron.
 */
export function cronLabel(cron: string | null | undefined): string {
  if (!cron) {
    return "";
  }
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return cron;
  }
  const [minute, hour, dayOfMonth, , weekday] = fields;
  if (!minute || !hour || !dayOfMonth || !weekday) {
    return cron;
  }
  if (minute !== "0" || hour !== "0") {
    return cron;
  }
  if (dayOfMonth === "*" && weekday === "*") {
    return "Every day at 00:00";
  }
  if (dayOfMonth === "*" && weekday !== "*") {
    if (/^\d+(,\d+)*$/.test(weekday)) {
      const days = weekday
        .split(",")
        .map((d) => WEEKDAY_NAMES[Number(d)])
        .filter(Boolean);
      if (days.length > 0) {
        return `Every ${days.join(", ")} at 00:00`;
      }
    }
    return cron;
  }
  if (weekday === "*" && /^\d+$/.test(dayOfMonth)) {
    return `On day ${Number(dayOfMonth)} of the month at 00:00`;
  }
  return cron;
}
