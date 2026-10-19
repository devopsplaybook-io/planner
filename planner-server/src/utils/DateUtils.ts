/**
 * Formats a Date as YYYY-MM-DD using its local calendar day, i.e. the
 * server timezone (the container's TZ). Never use toISOString() for this:
 * it converts to UTC first, which shifts the day for every deployment whose
 * TZ differs from UTC (e.g. local midnight in Paris becomes the previous
 * UTC day). Day-boundary comparisons (overdue, "today") must use this.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
