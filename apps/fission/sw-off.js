// The service worker shipped while offline mode is off (offline.config.mjs).
// An earlier build registered a real one that keeps the app for offline use;
// a browser that has it looks for a new sw.js on every visit and finds this
// one. It takes over at once, deletes everything the old worker kept,
// removes itself, and reloads the open tabs so they come from the live
// site. It has no fetch handler, so while it lives every request goes to
// the network.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("spindlelabs-")) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url).catch(() => {});
    })(),
  );
});
