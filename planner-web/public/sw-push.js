// Web Push event handlers.
// Imported by the Workbox-generated service worker (see workbox.importScripts in nuxt.config.ts).

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
    self.registration.showNotification(data.title || "Planner", {
      body: data.body || "",
      icon: "/images/logo.svg",
      badge: "/images/logo.svg",
      tag: data.tag || "planner",
      data: { url: data.url || "/" },
    }),
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
