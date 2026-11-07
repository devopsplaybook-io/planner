// Web Push event handlers.
// Imported by the Workbox-generated service worker (see workbox.importScripts in nuxt.config.ts).

// ── PWA share target ─────────────────────────────────────────────────────────
// Supported browsers POST the shared file to /share-target. The worker stores
// it in the same IndexedDB queue used by offline capture, then redirects to
// the inbox, which uploads it. Best effort: browsers without share-target (or
// without this worker) fall back to the server redirect.

const SHARE_DB_NAME = "planner-dictation-queue";
const SHARE_DB_VERSION = 1;
const SHARE_STORE = "items";
const SHARE_MAX_BYTES = 100 * 1024 * 1024;

function isShareTargetRequest(event) {
  if (event.request.method !== "POST") {
    return false;
  }
  const url = new URL(event.request.url);
  return url.origin === self.location.origin && url.pathname === "/share-target";
}

function shareRedirect(target) {
  return Response.redirect(
    new URL(target, self.location.origin).href,
    303,
  );
}

function queueSharedFile(file) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "id" });
      }
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      let id;
      try {
        id = crypto.randomUUID();
      } catch {
        id = `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const item = {
        id,
        clientId: id,
        blob: file,
        mimeType: file.type || "application/octet-stream",
        language: "auto",
        projectId: null,
        targetLanguage: null,
        size: file.size || 0,
        dateCreated: new Date().toISOString(),
      };
      try {
        const tx = db.transaction(SHARE_STORE, "readwrite");
        tx.objectStore(SHARE_STORE).put(item);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    };
  });
}

self.addEventListener("fetch", (event) => {
  if (!isShareTargetRequest(event)) {
    return;
  }
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.get("file");
        if (
          file &&
          typeof file === "object" &&
          typeof file.size === "number" &&
          file.size > 0 &&
          file.size <= SHARE_MAX_BYTES &&
          /^audio\//i.test(file.type || "")
        ) {
          if (await queueSharedFile(file)) {
            return shareRedirect("/inbox?shared=1");
          }
        }
      } catch {
        // Fall through to the unsupported fallback
      }
      return shareRedirect("/inbox?shared=unsupported");
    })(),
  );
});

self.addEventListener("push", (event) => {
  // A payload-less push is a silent ping, not something to display
  if (!event.data) {
    return;
  }
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Planner", body: event.data.text() };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Planner", {
        body: data.body || "",
        // Notification icons must be raster images (SVG is ignored by browsers)
        icon: "/images/logo-512.png",
        badge: "/images/badge-96.png",
        tag: data.tag || "planner",
        data: { url: data.url || "/" },
      }),
      // Forward to open pages for an in-app toast and a badge refresh.
      // The payload stays content-free (generic title/body and a URL).
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({
              type: "push",
              title: data.title || "Planner",
              body: data.body || "",
              url: data.url || "/",
              tag: data.tag || "planner",
              kind: data.kind || "",
            });
          }
        }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin)) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
