// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  type App,
} from "vue";
import {
  REGULAR_REFRESH_INTERVAL_MS,
  useRegularRefresh,
} from "./useRegularRefresh";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

function mountWithRefresh(refresh: () => unknown): App {
  const host = defineComponent({
    setup() {
      useRegularRefresh(refresh);
      return () => null;
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(host);
  app.mount(container);
  mounted.push(app);
  return app;
}

const mounted: App[] = [];

describe("useRegularRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    for (const app of mounted.splice(0)) {
      app.unmount();
    }
    setHidden(false);
    vi.useRealTimers();
  });

  it("uses a 60 second default interval", () => {
    expect(REGULAR_REFRESH_INTERVAL_MS).toBe(60 * 1000);
  });

  it("does not refresh immediately on mount", async () => {
    const refresh = vi.fn();
    mountWithRefresh(refresh);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes on each interval tick", async () => {
    const refresh = vi.fn();
    mountWithRefresh(refresh);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while the tab is hidden", async () => {
    const refresh = vi.fn();
    mountWithRefresh(refresh);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once on visibility regain after at least one interval hidden", async () => {
    const refresh = vi.fn();
    mountWithRefresh(refresh);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on a quick visibility regain", async () => {
    const refresh = vi.fn();
    mountWithRefresh(refresh);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS / 2);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips ticks while a previous refresh is still in flight", async () => {
    let resolveRefresh: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    mountWithRefresh(refresh);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The first refresh is still pending: the next tick must not start one
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    resolveRefresh?.();
    await vi.advanceTimersByTimeAsync(0);
    // No catch-up run for the skipped tick
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshing after a failed refresh", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(undefined);
    mountWithRefresh(refresh);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops on unmount", async () => {
    const refresh = vi.fn();
    const app = mountWithRefresh(refresh);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    app.unmount();
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(REGULAR_REFRESH_INTERVAL_MS);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
