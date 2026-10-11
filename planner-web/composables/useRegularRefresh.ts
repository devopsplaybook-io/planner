import { onMounted, onUnmounted } from "vue";

/** Interval for the regular in-place refresh of the main pages' lists. */
export const REGULAR_REFRESH_INTERVAL_MS = 60 * 1000;

/**
 * Regular in-place refresh of the data a main page displays: tasks may have
 * been updated elsewhere (another user, the LLM agent) while the page stays
 * open. The refresh is silent (no loading indicator, the list is not
 * unmounted, the scroll position is preserved) and re-reads the current
 * filters at each run. Ticks are skipped while the tab is hidden and while a
 * previous refresh is still in flight; a failed refresh keeps the current
 * list and the next tick retries. When the tab becomes visible again after
 * being hidden for at least one interval (e.g. a mobile PWA coming back to
 * the foreground, where timers are suspended), it refreshes immediately.
 */
export function useRegularRefresh(
  refresh: () => unknown,
  intervalMs = REGULAR_REFRESH_INTERVAL_MS,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastRunAt = 0;

  async function run() {
    if (inFlight) return;
    if (document.hidden) return;
    inFlight = true;
    lastRunAt = Date.now();
    try {
      await refresh();
    } catch {
      // Transient errors are ignored; the next tick retries
    } finally {
      inFlight = false;
    }
  }

  function onVisibilityChange() {
    if (!document.hidden && Date.now() - lastRunAt >= intervalMs) {
      run();
    }
  }

  function start() {
    stop();
    // A visibility regain counts time since the start (or the last run):
    // switching tabs quickly right after mount must not trigger a refresh
    lastRunAt = Date.now();
    timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  onMounted(start);
  onUnmounted(stop);

  return { start, stop };
}
