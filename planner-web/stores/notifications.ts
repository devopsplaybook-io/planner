import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Waits for the active service worker registration, with a timeout so the
 * UI never hangs when no service worker is available (e.g. dev mode).
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Service worker not available")),
        10000,
      ),
    ),
  ]);
}

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    // User opt-in preference, persisted locally (per browser/device)
    enabled: localStorage.getItem("notificationsEnabled") === "true",
    supported: false,
    serverEnabled: false,
    serverPublicKey: "",
    permission: "default" as NotificationPermission,
    loading: false,
  }),

  getters: {
    active: (state) =>
      state.enabled &&
      state.supported &&
      state.serverEnabled &&
      state.permission === "granted",
  },

  actions: {
    /**
     * Detects browser support and server configuration.
     * Re-syncs the push subscription with the server when notifications
     * are enabled (the server-side save is idempotent per endpoint).
     */
    async init() {
      this.supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!this.supported) {
        return;
      }
      this.permission = Notification.permission;
      try {
        const res = await api.get("/notifications/config");
        this.serverEnabled = !!res.data.enabled && !!res.data.publicKey;
        this.serverPublicKey = res.data.publicKey || "";
      } catch {
        this.serverEnabled = false;
        this.serverPublicKey = "";
      }
      if (this.enabled && this.permission === "granted" && this.serverEnabled) {
        try {
          await this.subscribe();
        } catch {
          // Keep the feature marked as enabled; will retry on next app start
        }
      }
    },

    async enable() {
      if (!this.supported || !this.serverEnabled) {
        return;
      }
      this.loading = true;
      try {
        this.permission = await Notification.requestPermission();
        if (this.permission !== "granted") {
          return;
        }
        await this.subscribe();
        this.enabled = true;
        localStorage.setItem("notificationsEnabled", "true");
      } finally {
        this.loading = false;
      }
    },

    async disable() {
      this.loading = true;
      try {
        const registration = await getServiceWorkerRegistration();
        const subscription =
          await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          try {
            await api.delete("/notifications/subscriptions", {
              data: { endpoint: subscription.endpoint },
            });
          } catch {
            // Server-side cleanup failure is not blocking
          }
        }
        this.enabled = false;
        localStorage.removeItem("notificationsEnabled");
      } finally {
        this.loading = false;
      }
    },

    async subscribe() {
      const registration = await getServiceWorkerRegistration();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(this.serverPublicKey),
      });
      const key = subscription.getKey("p256dh");
      const auth = subscription.getKey("auth");
      if (!key || !auth) {
        throw new Error("Push subscription keys unavailable");
      }
      await api.post("/notifications/subscriptions", {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, ""),
          auth: btoa(String.fromCharCode(...new Uint8Array(auth)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, ""),
        },
      });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useNotificationsStore, import.meta.hot),
  );
}
