// The service worker that makes the app work offline (offline mode).
// offline.mjs copies this file into the built app as sw.js with BUILD set:
// the build's version (a hash of every file it ships), the files to keep
// (`precache`: every file of the build but CNAME and the chunks loaded only
// on demand), the on-demand chunks (`onDemand`, kept the first time they
// load), each of those files' SHA-256 (`hashes`) and the bytes kept (`size`).
//
// One cache per version, filled whole before this worker takes over, every
// file checked against its hash, so a page always gets the app, its kernel
// worker, the kernel's .wasm and kernel.json from one build: never an old
// page with a new kernel, nor the next build's index.html (a deploy landing
// mid-install). A failed install leaves no cache behind; one that failed for
// lack of storage says so once and is not tried again for a day. A new
// version waits (the page shows "A new version is ready", offline.ts) until
// the user reloads or every tab is closed; the cache of the version in use
// when it takes over is kept, so a tab still running that one keeps finding
// its files. Requests to other sites (the AI providers) are never touched.

const BUILD = self.__SPINDLELABS_BUILD__ ?? { version: "dev", precache: [], onDemand: [], hashes: {}, size: 0 };
const PREFIX = "spindlelabs-";
const CURRENT = PREFIX + BUILD.version;
/** The worker's own small record (the version in use, an install that failed), not a version's cache. */
const STATE = PREFIX + "state";
const STATE_PATH = "__spindlelabs-state";
/** How long an install that failed for lack of storage is not tried again. */
const BACKOFF_MS = 24 * 3600 * 1000;

/**
 * The caches to delete once `current` is the version in use: every one of
 * ours but `current` and `previous`, the one in use when it took over (a
 * tab may still run it). `previous` null (not recorded): the newest of ours
 * made before `current` (`keys` is in the order the caches were made, as
 * caches.keys() gives it), or if `current` is missing, the newest other.
 * Others' caches (another prefix) and the record are left alone.
 */
function cachesToDelete(keys, current, previous) {
  const ours = keys.filter((k) => k.startsWith(PREFIX) && k !== STATE);
  const keep = new Set([current]);
  if (previous) keep.add(previous);
  else {
    const at = ours.indexOf(current);
    const before = (at === -1 ? ours : ours.slice(0, at)).filter((k) => k !== current);
    if (before.length) keep.add(before[before.length - 1]);
  }
  return ours.filter((k) => !keep.has(k));
}

/**
 * The version in use before `version` took over, from the record `state`
 * ({ active, before }): the one active then, or, when that was `version`
 * itself (only sw.js changed), the one before it. null when not known.
 */
function previousVersion(state, version) {
  if (!state?.active) return null;
  return state.active === version ? (state.before ?? null) : state.active;
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

/** Hex SHA-256 of `bytes`. */
async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether `response` is really `path` of `build`: OK, its bytes the hash
 * the build lists (so never another build's file, a proxy's rewrite or a
 * captive portal's sign-in page), and a script served as one (a page in a
 * script's place is refused before its bytes are read).
 */
async function isBuildFile(response, path, build) {
  const want = build.hashes?.[path];
  if (!response.ok || !want) return false;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (/\.m?js$/.test(path) && !type.includes("javascript")) return false;
  if (!/\.html?$/.test(path) && type.includes("text/html")) return false;
  return (await sha256(await response.clone().arrayBuffer())) === want;
}

/**
 * Anything else: the network first (kept in this version's cache when it
 * is one of the build's own files, checked, such as a chunk loaded on
 * demand), then any of our caches, so an older tab finds its own version's
 * files: when the network fails, and when the server no longer has the file
 * (404 or 410, an older build's file gone after a deploy; real-use hunt
 * A2). `env` is the worker's fetch and caches, the name of this version's
 * cache, its build, and `keep` (event.waitUntil) for the copy still being
 * checked once the answer is on its way.
 */
async function fromAnywhere(request, path, { fetch, caches, current, build, keep = () => {} }) {
  const fromCache = () => caches.match(request, { ignoreSearch: request.mode === "navigate" });
  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    const cached = await fromCache();
    if (cached) return cached;
    throw e;
  }
  if (response.ok && build?.hashes?.[path]) {
    const copy = response.clone();
    keep(
      isBuildFile(copy, path, build)
        .then((ok) => ok && caches.open(current).then((cache) => cache.put(request, copy)))
        .catch(() => {}), // storage full: the file still answered this once
    );
  }
  if (response.status === 404 || response.status === 410) return (await fromCache()) ?? response;
  return response;
}

async function readState(caches, scope) {
  if (!(await caches.has(STATE))) return {};
  const hit = await (await caches.open(STATE)).match(new URL(STATE_PATH, scope).href);
  try {
    return hit ? await hit.json() : {};
  } catch {
    return {};
  }
}
async function writeState(caches, scope, state) {
  const body = JSON.stringify(state);
  await (await caches.open(STATE)).put(new URL(STATE_PATH, scope).href, new Response(body, { headers: { "content-type": "application/json" } }));
}
const noRoom = () => Object.assign(new Error("not enough storage to keep this version for offline use"), { name: "QuotaExceededError" });

/**
 * Installs this version: every kept file straight from the server (never
 * the browser's HTTP cache) and checked against its hash, all or nothing.
 * A failure deletes the version's cache if this install made it. Too little
 * storage (estimated before downloading, or a write refused) is recorded:
 * the page is told once (`notify`), and for a day the install stops at once.
 * `env`: fetch, caches, build, current (its cache's name), scope, now(),
 * notify(message), estimate() (navigator.storage.estimate, or undefined).
 */
async function install({ fetch, caches, build, current, scope, now, notify, estimate }) {
  const state = await readState(caches, scope);
  const failed = state.failed;
  if (failed?.version === build.version && failed.reason === "storage" && now() - failed.at < BACKOFF_MS) throw noRoom();
  const existed = await caches.has(current);
  try {
    const room = await Promise.resolve(estimate?.()).catch(() => undefined);
    if (room && Number.isFinite(room.quota) && Number.isFinite(room.usage) && room.quota - room.usage < build.size) throw noRoom();
    const answers = await Promise.all(
      build.precache.map(async (path) => {
        const response = await fetch(new URL(path, scope).href, { cache: "reload" });
        if (!response.ok) throw new Error(`${path}: ${response.status} from the server`);
        if ((await sha256(await response.clone().arrayBuffer())) !== build.hashes[path]) throw new Error(`${path} changed on the server during the install (a newer build went up)`);
        return [path, response];
      }),
    );
    const cache = await caches.open(current);
    for (const [path, response] of answers) await cache.put(new URL(path, scope).href, response);
  } catch (e) {
    if (!existed) await caches.delete(current).catch(() => {});
    if (e?.name === "QuotaExceededError") {
      await writeState(caches, scope, { ...state, failed: { version: build.version, reason: "storage", at: now() } }).catch(() => {});
      await Promise.resolve(notify({ type: "no-room" })).catch(() => {});
    }
    throw e;
  }
  if (state.failed) {
    const { failed: _, ...rest } = state;
    await writeState(caches, scope, rest).catch(() => {});
  }
}

/**
 * Copies `path` (an on-demand chunk of this build) into this version's
 * cache from wherever it already is: another of our caches (an earlier
 * version's, same name) or, `fetch` given, the browser's HTTP cache or the
 * network (a page that loaded it before this worker controlled it). Only a
 * copy that is really this build's file (isBuildFile).
 */
async function keepOnDemand(path, { caches, build, current, scope, fetch }) {
  if (!build.onDemand?.includes(path)) return;
  const href = new URL(path, scope).href;
  const cache = await caches.open(current);
  if (await cache.match(href)) return;
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === STATE || name === current) continue;
    const hit = await (await caches.open(name)).match(href);
    if (hit && (await isBuildFile(hit, path, build))) return cache.put(href, hit);
  }
  if (!fetch) return;
  const response = await fetch(href, { cache: "force-cache" });
  if (await isBuildFile(response, path, build)) await cache.put(href, response);
}

/**
 * Takes over: the on-demand chunks an earlier version kept carried over
 * when this build has the same file, then every cache of ours deleted but
 * this version's and the one in use until now, and this version recorded as
 * the one in use.
 */
async function activate({ caches, build, current, scope }) {
  const state = await readState(caches, scope);
  for (const path of build.onDemand ?? []) await keepOnDemand(path, { caches, build, current, scope }).catch(() => {});
  const previous = previousVersion(state, build.version);
  // Nothing recorded (no version took over here before): the newest older cache stays. Recorded with none before: only this one.
  const keep = !state.active ? null : previous ? PREFIX + previous : current;
  for (const k of cachesToDelete(await caches.keys(), current, keep)) await caches.delete(k);
  await writeState(caches, scope, { ...state, active: build.version, before: previous });
}

if (typeof module === "object") module.exports = { activate, cachesToDelete, fromAnywhere, install, keepOnDemand, keptFile, PREFIX, previousVersion, STATE };
else {
  const scope = new URL(self.registration.scope);
  const relative = (url) => (url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null);
  const env = () => ({ fetch: (u, o) => fetch(new Request(u, o)), caches, build: BUILD, current: CURRENT, scope: scope.href });
  const tellPages = async (message) => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage(message);
  };

  self.addEventListener("install", (event) => {
    event.waitUntil(install({ ...env(), now: () => Date.now(), notify: tellPages, estimate: () => self.navigator?.storage?.estimate?.() }));
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(activate(env()));
  });

  self.addEventListener("message", (event) => {
    if (event.data?.type === "skip-waiting") self.skipWaiting();
    // A page that loaded files before this worker controlled it (the first
    // visit) names them, so an on-demand chunk among them is kept too.
    if (event.data?.type === "keep" && Array.isArray(event.data.paths)) {
      const paths = event.data.paths.filter((p) => typeof p === "string" && BUILD.onDemand?.includes(p));
      event.waitUntil(Promise.all(paths.map((p) => keepOnDemand(p, env()).catch(() => {}))));
    }
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== scope.origin) return;
    const path = relative(url);
    if (path === null || path === "sw.js" || path === STATE_PATH) return;
    const kept = keptFile(path, request.mode === "navigate", BUILD.precache);
    event.respondWith(
      kept === null ? fromAnywhere(request, path, { fetch: (r) => fetch(r), caches, current: CURRENT, build: BUILD, keep: (p) => keepAlive(event, p) }) : fromCurrent(kept, request),
    );
  });

  /** Keeps the worker alive for `promise` (a copy still being checked); a worker past the point of waiting just lets it run. */
  function keepAlive(event, promise) {
    try {
      event.waitUntil(promise);
    } catch {
      // the event is done: the copy may be cut short, never the answer
    }
  }

  /** A file this version keeps: from its cache, else (the cache cleared under us) the network. */
  async function fromCurrent(path, request) {
    const cache = await caches.open(CURRENT);
    return (await cache.match(new URL(path, scope).href)) ?? fetch(request);
  }
}
