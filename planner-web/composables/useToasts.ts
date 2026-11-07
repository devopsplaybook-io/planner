import { ref } from "vue";

export type ToastKind = "info" | "success" | "error";

export interface AppToast {
  id: string;
  title: string;
  message?: string;
  kind: ToastKind;
  /** Optional in-app destination (push notifications point at the inbox) */
  url?: string;
}

const TOAST_DURATION_MS = 8000;
const toasts = ref<AppToast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Lightweight in-app notifications (toast stack). Deliberately content-free:
 * push notifications only carry a title/body chosen by the server and a URL.
 */
export function useToasts() {
  function dismissToast(id: string): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function pushToast(
    input: Omit<AppToast, "id" | "kind"> & { kind?: ToastKind },
  ): string {
    const toast: AppToast = {
      id: newId(),
      kind: input.kind || "info",
      title: input.title,
      message: input.message,
      url: input.url,
    };
    toasts.value = [...toasts.value, toast].slice(-4);
    timers.set(
      toast.id,
      setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS),
    );
    return toast.id;
  }

  return { toasts, pushToast, dismissToast };
}