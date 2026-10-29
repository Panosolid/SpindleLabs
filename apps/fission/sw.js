// The service worker that makes the app work offline (offline mode).
// offline.mjs copies this file into the built app as sw.js with BUILD set:
// the build's version (a hash of every file it ships) and the files to
// keep (`precache`, every file of the build but the chunks loaded only on
// demand, which are kept the first time they are fetched).
//
// One cache per version, filled whole before this worker takes over, so a
// page always gets the app, its kernel worker, the kernel's .wasm and
// kernel.json from one build: never an old page with a new kernel. A new
// version waits (the page shows "A new version is ready", offline.ts) until
// the user reloads or every tab is closed; the cache of the version before
// it is kept, so a tab still running that one keeps finding its files.
// Requests to other sites (the AI providers) are never touched.

const BUILD = self.__SPINDLELABS_BUILD__ ?? { version: "dev", precache: [] };
const PREFIX = "spindlelabs-";
const CURRENT = PREFIX + BUILD.version;

/**
 * The caches to delete once `current` is the version in use: every one of
 * ours but `current` and the one made just before it (`keys` is in the
 * order the caches were made, as caches.keys() gives it). Others' caches
 * (another prefix) are left alone.
 */
function cachesToDelete(keys, current) {
  const ours = keys.filter((k) => k.startsWith(PREFIX));
  const at = ours.indexOf(current);
  const keep = new Set([current]);
  // The newest of ours made before `current`; if `current` is missing from
  // the list, the newest of the others.
  const before = (at === -1 ? ours : ours.slice(0, at)).filter((k) => k !== current);
  if (before.length) keep.add(before[before.length - 1]);
  return ours.filter((k) => !keep.has(k));
}

/**
 * What a same-origin GET of `path` (relative to the app's folder, no
 * leading slash, no query) is answered with: "index.html" or another kept
 * page for a page load, `path` itself when the build keeps it, else null
 * (the network, then any cache).
 */
function keptFile(path, navigate, precache) {
  if (navigate && (path === "" || path === "index.html")) return "index.html";
  return precache.includes(path) ? path : null;
}

/**
 * Anything else: the network first (kept in this version's cache when it
 * is one of the build's own files, such as a chunk loaded on demand), then
 * any of our caches, so an older tab finds its own version's files: when
 * the network fails, and when the server no longer has the file (404 or
 * 410, an older build's file gone after a deploy; real-use hunt A2). `env`
 * is the worker's fetch and caches, and the name of this version's cache.
 */
async function fromAnywhere(request, path, { fetch, caches, current }) {
  const fromCache = () => caches.match(request, { ignoreSearch: request.mode === "navigate" });
  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    const cached = await fromCache();
    if (cached) return cached;
    throw e;
  }
  if (response.ok && path.startsWith("assets/")) {
    const copy = response.clone();
    caches.open(current).then((cache) => cache.put(request, copy));
  }
  if (response.status === 404 || response.status === 410) return (await fromCache()) ?? response;
  return response;
}

if (typeof module === "object") module.exports = { cachesToDelete, fromAnywhere, keptFile, PREFIX };
else {
  const scope = new URL(self.registration.scope);
  const relative = (url) => (url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null);

  self.addEventListener("install", (event) => {
    // Every file straight from the server (never the browser's HTTP cache),
    // all or nothing: one missing file and this version is not installed.
    event.waitUntil(
      caches.open(CURRENT).then((cache) => cache.addAll(BUILD.precache.map((p) => new Request(new URL(p, scope), { cache: "reload" })))),
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(cachesToDelete(keys, CURRENT).map((k) => caches.delete(k)))));
  });

  self.addEventListener("message", (event) => {
    if (event.data?.type === "skip-waiting") self.skipWaiting();
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== scope.origin) return;
    const path = relative(url);
    if (path === null || path === "sw.js") return;
    const kept = keptFile(path, request.mode === "navigate", BUILD.precache);
    event.respondWith(kept === null ? fromAnywhere(request, path, { fetch: (r) => fetch(r), caches, current: CURRENT }) : fromCurrent(kept, request));
  });

  /** A file this version keeps: from its cache, else (the cache cleared under us) the network. */
  async function fromCurrent(path, request) {
    const cache = await caches.open(CURRENT);
    return (await cache.match(new URL(path, scope).href)) ?? fetch(request);
  }
}
