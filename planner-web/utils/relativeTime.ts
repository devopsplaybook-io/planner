const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Older timestamps fall back to the absolute locale date
const RELATIVE_CUTOFF_MS = 7 * DAY_MS;

/**
 * Compact relative time ("just now", "5m ago", "3h ago", "2d ago") for
 * recent timestamps, absolute locale date otherwise. Callers show the full
 * date separately (e.g. a title tooltip).
 */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const elapsed = Date.now() - time;
  if (elapsed < MINUTE_MS) {
    // Not yet a minute old (or clock skew in the future): "just now"
    return "just now";
  }
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < RELATIVE_CUTOFF_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
  }
  return date.toLocaleString();
}
