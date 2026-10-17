import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import {
  RELOAD_LOOP_GUARD_MS,
  UPDATE_CHECK_INTERVAL_MS,
  shouldAutoReload,
  useAppUpdate,
} from "./useAppUpdate";

describe("shouldAutoReload", () => {
  const base = {
    hadController: true,
    hasOpenDialog: false,
    lastReloadAt: null,
    now: 1_000_000,
  };

  it("reloads on a genuine update takeover", () => {
    expect(shouldAutoReload(base)).toBe(true);
  });

  it("does not reload the first claim of an uncontrolled page", () => {
    expect(shouldAutoReload({ ...base, hadController: false })).toBe(false);
  });

  it("does not reload while a dialog is open", () => {
    expect(shouldAutoReload({ ...base, hasOpenDialog: true })).toBe(false);
  });

  it("does not reload within the loop guard", () => {
    expect(
      shouldAutoReload({
        ...base,
        lastReloadAt: base.now - (RELOAD_LOOP_GUARD_MS - 1000),
      }),
    ).toBe(false);
  });

  it("reloads again after the loop guard has passed", () => {
    expect(
      shouldAutoReload({
        ...base,
        lastReloadAt: base.now - RELOAD_LOOP_GUARD_MS,
      }),
    ).toBe(true);
  });
});

describe("useAppUpdate", () => {
  function stubServiceWorker(controller: unknown) {
    const update = vi.fn().mockResolvedValue(undefined);
    const listeners = new Map<string, () => void>();
    const sw = {
      controller,
      addEventListener: (type: string, cb: () => void) =>
        listeners.set(type, cb),
      removeEventListener: (type: string) => listeners.delete(type),
      getRegistration: vi.fn().mockResolvedValue({ update }),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: sw,
      configurable: true,
    });
    return { update, listeners };
  }

  function mountHost() {
    let exposed: { showUpdateBanner: { value: boolean } };
    const host = defineComponent({
      setup(_, { expose }) {
        const api = useAppUpdate();
        exposed = api;
        expose(api);
        return () => h("div");
      },
    });
    const wrapper = mount(host);
    return { wrapper, api: exposed! };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // jsdom has no serviceWorker; drop the stub left by a test
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it("schedules periodic update checks via registration.update()", async () => {
    const { update } = stubServiceWorker({ scriptURL: "/sw.js" });
    const { wrapper } = mountHost();

    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("checks for an update when the tab becomes visible again", async () => {
    const { update } = stubServiceWorker({ scriptURL: "/sw.js" });
    const { wrapper } = mountHost();
    await vi.advanceTimersByTimeAsync(0);
    expect(update).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("ignores the first claim of a previously uncontrolled page", async () => {
    const { listeners } = stubServiceWorker(null);
    const { api, wrapper } = mountHost();
    await vi.advanceTimersByTimeAsync(0);

    listeners.get("controllerchange")?.();
    expect(api.showUpdateBanner.value).toBe(false);

    wrapper.unmount();
  });

  it("shows the banner instead of reloading while a dialog is open", async () => {
    const { listeners } = stubServiceWorker({ scriptURL: "/sw.js" });
    const { api, wrapper } = mountHost();
    await vi.advanceTimersByTimeAsync(0);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);

    listeners.get("controllerchange")?.();
    expect(api.showUpdateBanner.value).toBe(true);

    dialog.remove();
    wrapper.unmount();
  });
});
