import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "./useToasts";

describe("useToasts", () => {
  const { toasts, pushToast, dismissToast } = useToasts();

  beforeEach(() => {
    vi.useFakeTimers();
    toasts.value = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should keep only the four most recent toasts", () => {
    for (let index = 0; index < 6; index++) {
      pushToast({ title: `Toast ${index}` });
    }

    expect(toasts.value).toHaveLength(4);
    expect(toasts.value[0]?.title).toBe("Toast 2");
    expect(toasts.value[3]?.title).toBe("Toast 5");
  });

  it("should default to the info kind and keep the optional url", () => {
    pushToast({ title: "Hello", url: "/inbox" });

    expect(toasts.value[0]?.kind).toBe("info");
    expect(toasts.value[0]?.url).toBe("/inbox");
  });

  it("should auto-dismiss after eight seconds", () => {
    pushToast({ title: "Temporary" });

    vi.advanceTimersByTime(7999);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("should dismiss a toast manually", () => {
    const id = pushToast({ title: "Dismiss me" });

    dismissToast(id);

    expect(toasts.value).toHaveLength(0);
  });
});