// Offline mode's build side and the service worker's rules (npm test): the
// version and the files kept (offline.mjs), which caches go after an update
// and which requests are answered from the cache (sw.js). The browser side
// is e2e/offline.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { buildInfo, filesIn, onDemandChunks, ON_DEMAND, writeServiceWorker } from "../offline.mjs";

// sw.js is a classic script (a service worker), not a module: run it as one, with a `module` to hand its rules out.
const sandbox = { self: {}, module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), sandbox);
const { cachesToDelete, keptFile, PREFIX } = sandbox.module.exports;
const c = (v) => PREFIX + v;

test("the version, worked by hand", () => {
  // One file a.txt holding "x". SHA-256("x") = 2d711642…4881 (sha256sum), so
  // the one line is "a.txt", NUL, that hex and a newline, whose SHA-256
  // (printf 'a.txt\0%s\n' 2d71…4881 | sha256sum) starts d7a8ccc671c6d8c5.
  assert.deepEqual(buildInfo({ "a.txt": "x" }), { version: "d7a8ccc671c6d8c5", precache: ["a.txt"] });
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

test("caches deleted on taking over: all of ours but this version and the one before", () => {
  // Made in the order a, b, c; c takes over: a goes, b stays for a tab still on it.
  assert.deepEqual(cachesToDelete([c("a"), c("b"), c("c")], c("c")), [c("a")]);
  // The first install: nothing to delete.
  assert.deepEqual(cachesToDelete([c("a")], c("a")), []);
  // An older build put back (b after c was made): c is newer, not the one before, so it goes; a stays.
  assert.deepEqual(cachesToDelete([c("a"), c("b"), c("c")], c("b")), [c("c")]);
  // Our cache missing (cleared): the newest other stays.
  assert.deepEqual(cachesToDelete([c("a"), c("b")], c("z")), [c("a")]);
  // Another prefix is never ours to delete.
  assert.deepEqual(cachesToDelete(["webllm/model", c("a"), c("b"), c("c")], c("c")), [c("a")]);
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
