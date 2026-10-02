/**
 * Formats a Date as YYYY-MM-DD using its local calendar day.
 *
 * Never use toISOString() for this: it converts to UTC first, which shifts
 * the day backwards for every timezone with a positive UTC offset (e.g.
 * local midnight in Paris becomes the previous day in UTC).
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
