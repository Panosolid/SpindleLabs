// Offline mode's build side and the service worker's rules (npm test): the
// version and the files kept (offline.mjs), which caches go after an update
// and which requests are answered from the cache (sw.js). The browser side
// is e2e/offline.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { buildInfo, filesIn, offlinePlugin, onDemandChunks, ON_DEMAND, writeServiceWorker } from "../offline.mjs";

// sw.js is a classic script (a service worker), not a module: run it as one, with a `module` to hand its rules out.
const sandbox = { self: {}, module: { exports: {} }, crypto, Response, TextEncoder, URL };
vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), sandbox);
const { activate, cachesToDelete, fromAnywhere, install, keptFile, PREFIX, previousVersion, STATE } = sandbox.module.exports;
const c = (v) => PREFIX + v;

test("the version, worked by hand", () => {
  // One file a.txt holding "x". SHA-256("x") = 2d711642…4881 (sha256sum), so
  // the one line is "a.txt", NUL, that hex and a newline, whose SHA-256
  // (printf 'a.txt\0%s\n' 2d71…4881 | sha256sum) starts d7a8ccc671c6d8c5.
  // Its own hash is that SHA-256 of "x", and the bytes kept are its one byte.
  assert.deepEqual(buildInfo({ "a.txt": "x" }), {
    version: "d7a8ccc671c6d8c5",
    precache: ["a.txt"],
    onDemand: [],
    hashes: { "a.txt": "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881" },
    size: 1,
  });
});

test("the version changes with any byte, name or file, and only then", () => {
  const base = { "index.html": "<p>", "assets/k.wasm": "\0asm", "assets/a.js": "1" };
  const v = buildInfo(base).version;
  assert.equal(buildInfo({ "assets/a.js": "1", "assets/k.wasm": "\0asm", "index.html": "<p>" }).version, v, "order doesn't matter");
  assert.equal(buildInfo({ ...base, "sw.js": "anything", [ON_DEMAND]: "[]" }).version, v, "sw.js and the on-demand list are not part of it");
  assert.notEqual(buildInfo({ ...base, "assets/k.wasm": "\0asn" }).version, v, "one byte of the kernel");
  assert.notEqual(buildInfo({ "index.html": "<p>", "assets/k2.wasm": "\0asm", "assets/a.js": "1" }).version, v, "a renamed file");
  assert.notEqual(buildInfo({ ...base, "b.txt": "" }).version, v, "an added empty file");
  const { "assets/a.js": _, ...less } = base;
  assert.notEqual(buildInfo(less).version, v, "a removed file");
  // Moving a byte from a name into the contents must not collide: "ab"+"" vs "a"+"b".
  assert.notEqual(buildInfo({ ab: "" }).version, buildInfo({ a: "b" }).version);
});

test("the files kept: every file but sw.js, the list and the on-demand chunks, sorted", () => {
  const info = buildInfo({ "sw.js": "", [ON_DEMAND]: "", "index.html": "", "assets/lib.js": "", "assets/a.js": "", "favicon.svg": "" }, ["assets/lib.js"]);
  assert.deepEqual(info.precache, ["assets/a.js", "favicon.svg", "index.html"]);
  assert.deepEqual(info.onDemand, ["assets/lib.js"]);
  // Every kept and on-demand file has its hash (the install and the on-demand copies are checked against it); the empty file's is SHA-256 of nothing.
  assert.deepEqual(Object.keys(info.hashes).sort(), ["assets/a.js", "assets/lib.js", "favicon.svg", "index.html"]);
  assert.equal(info.hashes["index.html"], "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("CNAME (the custom domain, read by the host) is never kept: the server may not serve it, and one missing file stops the install", () => {
  const info = buildInfo({ CNAME: "spindlelabs.app", "index.html": "<p>" });
  assert.deepEqual(info.precache, ["index.html"]);
  assert.ok(!("CNAME" in info.hashes));
  // Still part of the version: a changed domain is a changed build.
  assert.notEqual(info.version, buildInfo({ CNAME: "other.app", "index.html": "<p>" }).version);
  // The size counts only what is kept: 3 bytes of "<p>".
  assert.equal(info.size, 3);
});

test("on-demand chunks: imported only by import()", () => {
  const bundle = {
    "index.js": { type: "chunk", fileName: "index.js", isEntry: true, isDynamicEntry: false, imports: ["shared.js"] },
    "shared.js": { type: "chunk", fileName: "shared.js", isEntry: false, isDynamicEntry: true, imports: [] }, // also imported statically: kept
    "lib.js": { type: "chunk", fileName: "lib.js", isEntry: false, isDynamicEntry: true, imports: [] },
    "k.wasm": { type: "asset", fileName: "k.wasm" },
  };
  assert.deepEqual(onDemandChunks(bundle), ["lib.js"]);
});

test("caches deleted on taking over: all of ours but this version and the one that was in use when it took over", () => {
  // Made in the order a, b, c; c takes over from b: a goes, b stays for a tab still on it.
  assert.deepEqual(cachesToDelete([c("a"), c("b"), c("c")], c("c"), c("b")), [c("a")]);
  // The first install: nothing to delete.
  assert.deepEqual(cachesToDelete([c("a")], c("a"), null), []);
  // An older build put back (b again, after c was made and took over): c was in use, so c stays and a goes.
  // (Changed deliberately from "the newest older cache": that kept a and deleted c, the cache of the tabs still running.)
  assert.deepEqual(cachesToDelete([c("a"), c("b"), c("c")], c("b"), c("c")), [c("a")]);
  // A rollback to the same bytes (a, b, a: a's cache is the oldest): b was in use, so b stays.
  assert.deepEqual(cachesToDelete([c("a"), c("b")], c("a"), c("b")), []);
  // A failed install's cache (d, made after c) is never "the one before": c, in use, stays.
  assert.deepEqual(cachesToDelete([c("c"), c("d"), c("e")], c("e"), c("c")), [c("d")]);
  // The one in use already gone: only this version stays.
  assert.deepEqual(cachesToDelete([c("a"), c("b")], c("b"), c("x")), [c("a")]);
  // Not known which was in use (nothing recorded): the newest of ours made before this one stays.
  assert.deepEqual(cachesToDelete([c("a"), c("b"), c("c")], c("c"), null), [c("a")]);
  assert.deepEqual(cachesToDelete([c("a"), c("b")], c("z"), null), [c("a")]);
  // Another prefix is never ours to delete, nor the worker's own record.
  assert.deepEqual(cachesToDelete(["webllm/model", STATE, c("a"), c("b"), c("c")], c("c"), c("b")), [c("a")]);
});

test("the version in use before this one took over, from the worker's record", () => {
  assert.equal(previousVersion(null, "c"), null, "nothing recorded");
  assert.equal(previousVersion({ active: "b" }, "c"), "b");
  // The same version again (only sw.js changed): the one before it.
  assert.equal(previousVersion({ active: "c", before: "b" }, "c"), "b");
  assert.equal(previousVersion({ active: "c" }, "c"), null);
});

test("requests answered from this version's cache", () => {
  const kept = ["assets/a.js", "index.html", "privacy.html"];
  assert.equal(keptFile("", true, kept), "index.html", "the app's folder (any query) is the app");
  assert.equal(keptFile("index.html", true, kept), "index.html");
  assert.equal(keptFile("privacy.html", true, kept), "privacy.html");
  assert.equal(keptFile("assets/a.js", false, kept), "assets/a.js");
  assert.equal(keptFile("assets/lib.js", false, kept), null, "an on-demand chunk: the network first");
  assert.equal(keptFile("nothing.html", true, kept), null, "a page the build doesn't have: the network");
  assert.equal(keptFile("", false, kept), null, "the folder fetched, not loaded as a page");
});

test("writeServiceWorker on a built folder: sw.js runs as a script and lists the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "offline-"));
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<p>");
    writeFileSync(join(dir, "assets/k.wasm"), "\0asm");
    writeFileSync(join(dir, "assets/lib.js"), "big");
    writeFileSync(join(dir, ON_DEMAND), JSON.stringify(["assets/lib.js"]));
    const info = writeServiceWorker(dir);
    assert.deepEqual(info.precache, ["assets/k.wasm", "index.html"]);
    assert.deepEqual(filesIn(dir), ["assets/k.wasm", "assets/lib.js", "index.html", ON_DEMAND, "sw.js"]);
    // Run in a sandbox as a service worker would load it, up to its first use of `self.registration`.
    const self = { addEventListener() {}, registration: { scope: "https://example.test/app/" } };
    vm.runInNewContext(readFileSync(join(dir, "sw.js"), "utf8"), { self, URL });
    assert.deepEqual(JSON.parse(JSON.stringify(self.__SPINDLELABS_BUILD__)), info); // (made in the sandbox: compared as JSON)
    assert.equal(writeServiceWorker(dir).version, info.version, "writing it again (sw.js now in the folder) gives the same version");
    writeFileSync(join(dir, "index.html"), "<p>B");
    assert.notEqual(writeServiceWorker(dir).version, info.version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline mode off: the plugin ships the clean-up worker and no manifest link", async () => {
  const { offlinePlugin } = await import("../offline.mjs");
  assert.deepEqual(offlinePlugin(false).transformIndexHtml(), []);
  assert.equal(offlinePlugin(true).transformIndexHtml()[0].attrs.rel, "manifest");
  const off = readFileSync(new URL("../sw-off.js", import.meta.url), "utf8");
  // It must delete our caches, remove itself, and handle no fetch (so the network answers).
  assert.match(off, /caches\.delete/);
  assert.match(off, /registration\.unregister\(\)/);
  assert.ok(!off.includes('"fetch"'));
  // Breaking it that way is caught: without unregister the pattern is gone.
  assert.doesNotMatch(off.replace("registration.unregister()", ""), /registration\.unregister\(\)/);
});

test("a build into a folder given by its full path writes sw.js there (the plant builds, soak-plants.mjs and monkey-plants.mjs, build into the temp folder)", () => {
  const out = mkdtempSync(join(tmpdir(), "offline-out-"));
  try {
    const plugin = offlinePlugin(false);
    plugin.configResolved({ root: "/somewhere/apps/fission", build: { outDir: out } });
    plugin.closeBundle();
    assert.ok(existsSync(join(out, "sw.js")), "sw.js in the folder named");
    // A relative folder still means one inside the app's root.
    const plugin2 = offlinePlugin(false);
    plugin2.configResolved({ root: out, build: { outDir: "dist-here" } });
    mkdirSync(join(out, "dist-here"));
    plugin2.closeBundle();
    assert.ok(existsSync(join(out, "dist-here", "sw.js")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

const SCOPE = "https://example.test/app/";
const url = (p) => new URL(p, SCOPE).href;

/**
 * Cache Storage as the worker sees it: caches by name in the order made,
 * each a map of URL to a stored response (put stores a copy, match hands
 * a fresh one). `full` makes every put fail as a full disk does (but the
 * worker's small record, written once the half-filled cache is deleted).
 */
function fakeCaches() {
  const all = new Map();
  const store = {
    full: false,
    puts: [],
    async open(name) {
      if (!all.has(name)) all.set(name, new Map());
      const m = all.get(name);
      return {
        async put(request, response) {
          const key = typeof request === "string" ? request : request.url;
          if (store.full && name !== STATE) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
          const body = await response.arrayBuffer();
          m.set(key, { body, status: response.status, headers: [...response.headers] });
          store.puts.push([name, key]);
        },
        async match(request) {
          const s = m.get(typeof request === "string" ? request : request.url);
          return s && new Response(s.body.slice(0), { status: s.status, headers: s.headers });
        },
        async keys() {
          return [...m.keys()].map((u) => ({ url: u }));
        },
      };
    },
    async has(name) {
      return all.has(name);
    },
    async delete(name) {
      return all.delete(name);
    },
    async keys() {
      return [...all.keys()];
    },
    async match(request) {
      for (const name of all.keys()) {
        const hit = await (await store.open(name)).match(request);
        if (hit) return hit;
      }
      return undefined;
    },
    /** The URLs a cache holds, sorted ([] for none). */
    async urls(name) {
      return all.has(name) ? [...all.get(name).keys()].sort() : [];
    },
    async text(name, u) {
      const r = await (await store.open(name)).match(u);
      return r && r.text();
    },
  };
  return store;
}

/** A server: `files` maps a path to [body, content-type] or a status; anything else is a 404. `offline` makes every fetch throw. */
function fakeServer(files) {
  const server = {
    offline: false,
    asked: [],
    fetch: async (request, options) => {
      const u = typeof request === "string" ? request : request.url;
      server.asked.push([new URL(u).pathname.slice("/app/".length), options?.cache ?? null]);
      if (server.offline) throw new TypeError("Failed to fetch");
      const f = files[new URL(u).pathname.slice("/app/".length)];
      if (f === undefined) return new Response("", { status: 404 });
      if (typeof f === "number") return new Response("", { status: f });
      return new Response(f[0], { status: 200, headers: { "content-type": f[1] } });
    },
  };
  return server;
}

const JS = "text/javascript";
const LIB = "export const run = 1;";
const build = (files, onDemand = []) => {
  const info = buildInfo(Object.fromEntries(Object.entries(files).map(([p, [body]]) => [p, body])), onDemand);
  return { ...info, current: c(info.version) };
};

test("anything else: the network first, then any of our caches when it fails or no longer has the file", async () => {
  const files = { "index.html": ["<p>A", "text/html"], "assets/kernel-A.wasm": ["\0asm", "application/wasm"] };
  const B = build(files);
  const request = { url: url("assets/kernel-A.wasm"), mode: "cors" };
  const env = (server, caches, kept = []) => ({ fetch: server.fetch, caches, current: B.current, build: B, keep: (p) => kept.push(p) });
  // A file of this build, fetched fine: from the network, and kept in this version's cache.
  let caches = fakeCaches();
  let kept = [];
  let server = fakeServer(files);
  assert.equal(await (await fromAnywhere(request, "assets/kernel-A.wasm", env(server, caches, kept))).text(), "\0asm");
  await Promise.all(kept);
  assert.deepEqual(await caches.urls(B.current), [request.url]);
  // Offline: from the cache that has it.
  server.offline = true;
  const old = fakeCaches();
  await (await old.open(c("A"))).put(request.url, new Response("A's", { status: 200 }));
  assert.equal(await (await fromAnywhere(request, "assets/kernel-A.wasm", env(server, old))).text(), "A's");
  // Real-use hunt A2: a tab still on build A, after another tab took B; the server now has only B's files,
  // so A's .wasm is a 404 there, and A's cache (kept for such a tab) answers.
  for (const status of [404, 410]) {
    kept = [];
    const r = await fromAnywhere(request, "assets/kernel-A.wasm", env(fakeServer({ "assets/kernel-A.wasm": status }), old, kept));
    assert.equal(await r.text(), "A's", `${status}`);
    await Promise.all(kept);
    assert.deepEqual(await old.urls(B.current), [], "an error is never kept");
  }
  // In no cache either: the server's own answer.
  assert.equal((await fromAnywhere(request, "assets/kernel-A.wasm", env(fakeServer({}), fakeCaches()))).status, 404);
  // A server error is the server's to report: not hidden by an old copy.
  assert.equal((await fromAnywhere(request, "assets/kernel-A.wasm", env(fakeServer({ "assets/kernel-A.wasm": 500 }), old))).status, 500);
  // Offline and in no cache: the network's error.
  server = fakeServer({});
  server.offline = true;
  await assert.rejects(fromAnywhere(request, "assets/kernel-A.wasm", env(server, fakeCaches())), /Failed to fetch/);
});

test("an on-demand chunk is kept only when it is really this build's file: never a portal's page, another build's file or a changed one", async () => {
  const files = { "index.html": ["<p>", "text/html"], "assets/lib-1.js": [LIB, JS] };
  const B = build(files, ["assets/lib-1.js"]);
  const request = { url: url("assets/lib-1.js"), mode: "cors" };
  const tryWith = async (server, path = "assets/lib-1.js", req = request) => {
    const caches = fakeCaches();
    const kept = [];
    await fromAnywhere(req, path, { fetch: server.fetch, caches, current: B.current, build: B, keep: (p) => kept.push(p) });
    await Promise.all(kept);
    return caches.urls(B.current);
  };
  assert.deepEqual(await tryWith(fakeServer(files)), [request.url], "the real chunk is kept");
  // A captive portal (hotel wifi) answers every request 200 with its sign-in page: never kept as the chunk.
  assert.deepEqual(await tryWith(fakeServer({ "assets/lib-1.js": ["<html>sign in</html>", "text/html"] })), [], "a page in its place");
  // Script-typed but not its bytes (a proxy's rewrite, a half-deployed server): not kept either.
  assert.deepEqual(await tryWith(fakeServer({ "assets/lib-1.js": ["export const run = 2;", JS] })), [], "other bytes");
  // A script, its bytes right, but served as something else: not kept (it could not run as a module either).
  assert.deepEqual(await tryWith(fakeServer({ "assets/lib-1.js": [LIB, "text/plain"] })), [], "not served as a script");
  // Another build's file (an older tab's): never in this version's cache.
  const other = { url: url("assets/old-9.js"), mode: "cors" };
  assert.deepEqual(await tryWith(fakeServer({ "assets/old-9.js": ["x", JS] }), "assets/old-9.js", other), [], "not this build's");
});

const BUILD_FILES = {
  "index.html": ['<script src="assets/a-1.js"></script>', "text/html"],
  "assets/a-1.js": ["console.log(1)", JS],
  "assets/k-1.wasm": ["\0asm", "application/wasm"],
  "assets/lib-1.js": [LIB, JS],
};
function installEnv(server, caches, B, extra = {}) {
  const told = [];
  return { told, env: { fetch: server.fetch, caches, build: B, current: B.current, scope: SCOPE, now: () => 1000, notify: (m) => told.push(m.type), estimate: async () => ({ usage: 0, quota: 1e9 }), ...extra } };
}

test("install: every kept file straight from the server, checked against its hash, all or nothing", async () => {
  const B = build(BUILD_FILES, ["assets/lib-1.js"]);
  const caches = fakeCaches();
  const server = fakeServer(BUILD_FILES);
  await install(installEnv(server, caches, B).env);
  assert.deepEqual(await caches.urls(B.current), ["assets/a-1.js", "assets/k-1.wasm", "index.html"].map(url), "the kept files, not the on-demand chunk");
  assert.ok(server.asked.every(([, how]) => how === "reload"), "never from the browser's HTTP cache");
});

test("install: a file missing or changed on the server (a deploy landing mid-install) refuses it and leaves no cache behind", async () => {
  const B = build(BUILD_FILES, ["assets/lib-1.js"]);
  // The next build's index.html already live while this one installs (its own script renamed).
  for (const [what, files] of [
    ["the next build's page", { ...BUILD_FILES, "index.html": ['<script src="assets/a-2.js"></script>', "text/html"] }],
    ["a file gone", { ...BUILD_FILES, "assets/k-1.wasm": 404 }],
  ]) {
    const caches = fakeCaches();
    const { env, told } = installEnv(fakeServer(files), caches, B);
    await assert.rejects(install(env), what === "a file gone" ? /404/ : /index\.html.*changed/);
    assert.deepEqual(await caches.keys(), [], `${what}: the failed version's cache is gone`);
    assert.deepEqual(told, [], `${what}: not a storage failure, nothing to say`);
  }
  // The same version's cache already there (a rollback to bytes this browser keeps, in use by a tab): a failed install leaves it alone.
  const caches = fakeCaches();
  await (await caches.open(B.current)).put(url("index.html"), new Response(BUILD_FILES["index.html"][0]));
  await assert.rejects(install(installEnv(fakeServer({ ...BUILD_FILES, "assets/k-1.wasm": 404 }), caches, B).env));
  assert.deepEqual(await caches.urls(B.current), [url("index.html")], "a cache that was there before stays");
});

test("install with too little storage: said once, then not tried again (nothing downloaded) for a day", async () => {
  const B = build(BUILD_FILES, ["assets/lib-1.js"]);
  const caches = fakeCaches();
  caches.full = true;
  const server = fakeServer(BUILD_FILES);
  let now = 5_000;
  const run = () => {
    const { env, told } = installEnv(server, caches, B, { now: () => now });
    return install(env).then(() => told, (e) => ({ told, error: e.name }));
  };
  assert.deepEqual(await run(), { told: ["no-room"], error: "QuotaExceededError" }, "the disk full: the user is told");
  assert.deepEqual(await caches.keys(), [STATE], "the half-filled cache is gone; the failure is recorded");
  const asked = server.asked.length;
  assert.ok(asked >= 3);
  // The next page loads within the day: the install stops at once, downloads nothing, and says nothing again.
  now += 23 * 3600_000;
  assert.deepEqual(await run(), { told: [], error: "QuotaExceededError" });
  assert.equal(server.asked.length, asked, "nothing downloaded again");
  // After a day it tries again; room made, it installs.
  now += 2 * 3600_000;
  caches.full = false;
  assert.deepEqual(await run(), []);
  assert.equal((await caches.urls(B.current)).length, 3);
  // The estimate already short of the build's size: refused before downloading anything.
  const c2 = fakeCaches();
  const s2 = fakeServer(BUILD_FILES);
  const { env, told } = installEnv(s2, c2, B, { estimate: async () => ({ usage: 1000, quota: 1000 + B.size - 1 }) });
  await assert.rejects(install(env), (e) => e.name === "QuotaExceededError");
  assert.deepEqual([told, s2.asked], [["no-room"], []]);
  // The control: exactly the room it needs is enough.
  const c3 = fakeCaches();
  await install(installEnv(fakeServer(BUILD_FILES), c3, B, { estimate: async () => ({ usage: 1000, quota: 1000 + B.size }) }).env);
  assert.equal((await c3.urls(B.current)).length, 3);
  // A different (later) version is not held back by an older one's failure.
  const c4 = fakeCaches();
  c4.full = true;
  await install(installEnv(fakeServer(BUILD_FILES), c4, B).env).catch(() => {});
  c4.full = false;
  const later = build({ ...BUILD_FILES, "index.html": ["<p>later", "text/html"] }, ["assets/lib-1.js"]);
  await install(installEnv(fakeServer({ ...BUILD_FILES, "index.html": ["<p>later", "text/html"] }), c4, later).env);
  assert.equal((await c4.urls(later.current)).length, 3);
});

test("activate: the version in use is recorded and kept; the on-demand chunk carried over when it is the same file", async () => {
  const A = build(BUILD_FILES, ["assets/lib-1.js"]);
  const filesB = { ...BUILD_FILES, "index.html": ["<p>B", "text/html"] };
  const B = build(filesB, ["assets/lib-1.js"]);
  const filesC = { ...filesB, "index.html": ["<p>C", "text/html"], "assets/lib-2.js": ["export const run = 2;", JS] };
  delete filesC["assets/lib-1.js"];
  const C = build(filesC, ["assets/lib-2.js"]);
  const caches = fakeCaches();
  const go = async (X, files) => {
    await install(installEnv(fakeServer(files), caches, X).env);
    await activate({ caches, build: X, current: X.current, scope: SCOPE });
  };
  await go(A, BUILD_FILES);
  // The AI runner loaded under A: kept in A's cache.
  await (await caches.open(A.current)).put(url("assets/lib-1.js"), new Response(LIB, { headers: { "content-type": JS } }));
  await go(B, filesB);
  assert.deepEqual((await caches.keys()).filter((k) => k !== STATE).sort(), [A.current, B.current].sort(), "A kept for a tab still on it");
  assert.ok((await caches.urls(B.current)).includes(url("assets/lib-1.js")), "the same chunk (same name, same hash) carried over to B");
  // C: A goes (B was in use), and C's runner is a new file, not carried.
  await go(C, filesC);
  assert.deepEqual((await caches.keys()).filter((k) => k !== STATE).sort(), [B.current, C.current].sort());
  assert.ok(!(await caches.urls(C.current)).some((u) => u.includes("lib-")), "a changed chunk is never carried");
  // A copy whose bytes don't match the new build's hash (a portal's page kept by an older worker) is not carried.
  const D = build(filesB, ["assets/lib-1.js"]);
  const caches2 = fakeCaches();
  await (await caches2.open(c("old"))).put(url("assets/lib-1.js"), new Response("<html>sign in", { headers: { "content-type": JS } }));
  await install(installEnv(fakeServer(filesB), caches2, D).env);
  await activate({ caches: caches2, build: D, current: D.current, scope: SCOPE });
  assert.ok(!(await caches2.urls(D.current)).some((u) => u.includes("lib-")));
});

test("activate: a failed install's leftovers and a rollback never cost the cache of the version in use", async () => {
  const files = (mark) => ({ ...BUILD_FILES, "index.html": [`<p>${mark}`, "text/html"] });
  const [A, B, D] = ["A", "B", "D"].map((m) => build(files(m), ["assets/lib-1.js"]));
  const caches = fakeCaches();
  const go = async (X, mark) => {
    await install(installEnv(fakeServer(files(mark)), caches, X).env);
    await activate({ caches, build: X, current: X.current, scope: SCOPE });
  };
  await go(A, "A");
  await go(B, "B");
  // An empty cache made by an older worker's failed install (made after B): never taken for the one before.
  await caches.open(D.current);
  // A, B, A: the revert's cache is A's own (the oldest); B was in use, so B stays.
  await go(A, "A");
  assert.deepEqual((await caches.keys()).filter((k) => k !== STATE).sort(), [A.current, B.current].sort());
  assert.deepEqual(JSON.parse(await caches.text(STATE, url("__spindlelabs-state"))).active, A.version);
});
