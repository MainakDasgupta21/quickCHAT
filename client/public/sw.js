const APP_HOME_URL = "/";
const DEFAULT_TITLE = "quickCHAT";
const DEFAULT_BODY = "You have a new message.";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const parsePushData = (event) => {
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
};

const focusOrOpenHome = async () => {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clients) {
    let clientOrigin = "";
    try {
      clientOrigin = new URL(client.url).origin;
    } catch {
      clientOrigin = "";
    }
    if (clientOrigin !== self.location.origin) continue;

    if (typeof client.navigate === "function") {
      try {
        await client.navigate(APP_HOME_URL);
      } catch {
        // Focusing is still useful even if navigate fails.
      }
    }
    await client.focus();
    return;
  }

  await self.clients.openWindow(APP_HOME_URL);
};

self.addEventListener("push", (event) => {
  const payload = parsePushData(event);
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : DEFAULT_TITLE;
  const body =
    typeof payload.body === "string" && payload.body.trim()
      ? payload.body.trim()
      : DEFAULT_BODY;

  const options = {
    body,
    icon: payload.icon || "/favicon.svg",
    badge: payload.badge || "/favicon.svg",
    tag: payload.tag || "quickchat-notification",
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpenHome());
});
