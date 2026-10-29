// Browser check of offline mode (sw.js, src/offline.ts, offline.mjs). The
// built app is served by a server of this test's own, so it can be stopped
// and its folder swapped for a newer build:
// - Offline: the app loaded once, the server stopped and the browser offline,
//   a reload still opens it; a box is modelled and exported as STL (684
//   bytes), the privacy page opens, and the AI assistant says a remote
//   provider needs internet (and lets you ask again once back online). At
//   1280 px with the mouse and 375 px with taps. The control: with the
//   service worker blocked the same reload fails.
// - Installable: the manifest's name, start and icons (PNG sizes read from
//   their headers).
// - Never in a frame: the app framed by a page of its own site registers no
//   worker and keeps nothing (frame-guard.ts stops it first).
// - Updates: build B (index.html marked, the kernel's .wasm renamed and the
//   kernel worker changed to load it) put up while two tabs run build A: a
//   reload still gives A, whole (A's .wasm), and says a new version is
//   ready; Reload gives B, whole (B's .wasm, the kernel handshake passes,
//   kernel_version answers, the box kept); the other tab (375 px) says it
//   was updated elsewhere, still finds A's files the server no longer has
//   (a 404 answered from A's cache), and its Reload (a tap) gives B. Build C after
//   it: A's cache goes, B's stays for a tab still on it. A broken build D
//   (its list names a file the server doesn't have) never installs, and C
//   runs on untouched.
// Run with `npm run e2e`, after `npm run build`; `E2E_SHOTS` saves screenshots.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";
import { serviceWorkerSource, writeServiceWorker } from "../offline.mjs";

// Offline mode is off in the normal build (offline.config.mjs), so this runs
// on a build with it on: `npm run e2e:offline` builds one into dist-offline/
// (E2E_DIST names another). On the normal build it has nothing to check
// (e2e/offline-off.mjs checks that one).
const DIST = fileURLToPath(new URL(process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : "../dist/", import.meta.url));
if (!existsSync(join(DIST, "sw.js"))) throw new Error("build the app first (npm run build): dist/sw.js is missing");
if (!readFileSync(join(DIST, "sw.js"), "utf8").startsWith("self.__SPINDLELABS_BUILD__")) {
  console.log("offline: skipped, this build has offline mode off (npm run e2e:offline builds one with it on)");
  process.exit(0);
}
const shots = process.env.E2E_SHOTS;
const work = mkdtempSync(join(tmpdir(), "offline-e2e-"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
/** The app's server: serves `root` (swappable), and a page framing the app at /frame-it. */
const site = { root: DIST, server: null, port: 4240 };
function startServer() {
  site.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/frame-it") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><iframe id="app" src="/?test-hooks" style="width:800px;height:600px"></iframe>`);
    }
    const file = join(site.root, path.endsWith("/") ? path + "index.html" : path);
    if (!file.startsWith(site.root) || !existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  return new Promise((done) => site.server.listen(site.port, "127.0.0.1", done));
}
function stopServer() {
  site.server.closeAllConnections();
  return new Promise((done) => site.server.close(done));
}
const app = `http://127.0.0.1:${site.port}/`;

/** A copy of `from` as build `mark`: index.html marked, sw.js written again. `change` edits it first. */
function makeBuild(from, mark, change = () => {}) {
  const dir = join(work, mark) + "/";
  cpSync(from, dir, { recursive: true });
  const index = join(dir, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace("<head>", `<head>\n    <meta name="spindlelabs-build" content="${mark}" />`));
  change(dir);
  return { dir, info: writeServiceWorker(dir) };
}
const wasmOf = (dir) => readdirSync(join(dir, "assets")).find((f) => f.endsWith(".wasm"));

// Driven by Playwright, the full Chromium a sandbox has (/opt/pw-browsers/chromium,
// new headless) holds every service worker update of this app back about 90 s
// (the same Chromium on its own, no Playwright: 13 ms; a page without the app
// script: no hold), so here the checks use its headless shell, the Chromium
// Playwright itself starts headless, as on CI.
if (!process.env.E2E_CHROMIUM && existsSync("/opt/pw-browsers")) {
  for (const d of readdirSync("/opt/pw-browsers").filter((n) => n.startsWith("chromium_headless_shell-")))
    for (const sub of readdirSync(join("/opt/pw-browsers", d))) {
      const shell = join("/opt/pw-browsers", d, sub, "chrome-headless-shell");
      if (existsSync(shell)) process.env.E2E_CHROMIUM = shell;
    }
}
const browser = await launch();
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack?.split("\n").slice(0, 12).join("\n  ")}`);
  }
}

const viewports = { 1280: { width: 1280, height: 800 }, 375: { width: 375, height: 667 } };
async function newApp(width, serviceWorkers = "allow") {
  const context = await browser.newContext({ viewport: viewports[width], hasTouch: width === 375, serviceWorkers, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  return { context, page };
}
const kernelUp = (page) => page.waitForFunction(() => /kernel v/.test(document.querySelector("#version")?.textContent ?? ""), null, { timeout: 20000 });
const controlled = (page) => page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
const buildMark = (page) => page.evaluate(() => document.querySelector('meta[name="spindlelabs-build"]')?.content ?? null);
const ourCaches = (page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("spindlelabs-")));
const AI_REMOTE = JSON.stringify({ kind: "api-key", vendor: "anthropic" });

try {
  await startServer();
  const built = JSON.parse(readFileSync(join(DIST, "sw.js"), "utf8").split("\n")[0].replace(/^self\.__SPINDLELABS_BUILD__ = /, "").replace(/;$/, ""));

  for (const width of [1280, 375]) {
    const tap = width === 375;
    await check(`${width} px: loaded once, then with no server and no network a reload opens the app; a box is modelled and exported as STL`, async () => {
      const { context, page } = await newApp(width);
      try {
        await page.goto(`${app}?test-hooks`);
        await page.evaluate((s) => localStorage.setItem("fission.ai.settings", s), AI_REMOTE);
        await kernelUp(page);
        await page.evaluate(() => navigator.serviceWorker.ready);
        // Every file the build keeps is in this version's cache.
        const kept = await page.evaluate(async (v) => {
          const cache = await caches.open(`spindlelabs-${v}`);
          return (await cache.keys()).map((r) => new URL(r.url).pathname.slice(1)).sort();
        }, built.version);
        assert.deepEqual(kept, [...built.precache].sort());
        assert.ok(kept.some((p) => p.endsWith(".wasm")) && kept.some((p) => p.includes("kernel.worker")), "the kernel and its worker are kept");

        await stopServer();
        await context.setOffline(true);
        await page.reload();
        await kernelUp(page);
        assert.equal(await page.evaluate(() => navigator.onLine), false);
        await startWithBox(page, tap);
        // 12 triangles: 80 header + 4 count + 12 · 50 = 684 bytes.
        const [stl] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
        assert.equal(readFileSync(await stl.path()).length, 684);
        // The AI: a provider on the internet can't be asked offline, and says why.
        assert.equal(await page.$eval("#ai-ask-button", (b) => b.disabled), true, "Ask is off offline");
        assert.match(await page.textContent("#ai-ask-note"), /^You're offline: .+ needs an internet connection\. Everything else in SpindleLabs works offline\.$/);
        if (shots) await page.screenshot({ path: `${shots}/offline-box-${width}.png` });
        // The privacy page opens offline too.
        const privacy = await context.newPage();
        await privacy.goto(`${app}privacy.html`);
        assert.match(await privacy.title(), /privacy/i);
        await privacy.close();
        // Back online: Ask comes back on, the note goes.
        await context.setOffline(false);
        await page.waitForFunction(() => !document.querySelector("#ai-ask-button").disabled);
        assert.equal(await page.textContent("#ai-ask-note"), "");
      } finally {
        await context.close();
        if (!site.server.listening) await startServer();
      }
    });
  }

  await check("the control: with the service worker blocked, the same reload with no server fails", async () => {
    const { context, page } = await newApp(1280, "block");
    try {
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      await stopServer();
      await context.setOffline(true);
      await assert.rejects(page.reload(), /ERR_INTERNET_DISCONNECTED|offline|NS_ERROR|Could not connect/i);
    } finally {
      await context.close();
      await startServer();
    }
  });

  await check("installable: the manifest names the app, starts in its folder, and its icons are 192 and 512 px PNGs", async () => {
    const { context, page } = await newApp(1280);
    try {
      await page.goto(app);
      const href = await page.$eval('link[rel="manifest"]', (l) => l.href);
      const manifest = await (await page.request.get(href)).json();
      assert.equal(manifest.name, "SpindleLabs");
      assert.equal(manifest.display, "standalone");
      assert.equal(new URL(manifest.start_url, href).href, app);
      for (const [n, icon] of [[192, manifest.icons[0]], [512, manifest.icons[1]]]) {
        const png = await (await page.request.get(new URL(icon.src, href).href)).body();
        // A PNG's IHDR: width and height as big-endian 32-bit numbers at bytes 16 and 20.
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), icon.sizes], [n, n, `${n}x${n}`]);
      }
    } finally {
      await context.close();
    }
  });

  await check("framed by a page of its own site, the app registers no worker and keeps nothing", async () => {
    const { context, page } = await newApp(1280);
    try {
      await page.goto(`${app}frame-it`);
      const frame = page.frameLocator("#app");
      await frame.locator("text=doesn't run inside another page's frame").waitFor();
      await page.waitForTimeout(1500); // time a registration would have had
      assert.deepEqual(await page.evaluate(async () => [(await navigator.serviceWorker.getRegistrations()).length, (await caches.keys()).length]), [0, 0]);
      // The control: the same app unframed registers its worker.
      await page.goto(app);
      await page.evaluate(() => navigator.serviceWorker.ready);
      assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 1);
    } finally {
      await context.close();
    }
  });

  await check("updates: a new build waits, Reload gives it whole (its own kernel), the other tab is told, the cache before last goes, a broken build never installs", async () => {
    const A = makeBuild(DIST, "A");
    // B: the kernel's .wasm renamed and the kernel worker changed (same name) to load the new name.
    const wasmA = wasmOf(A.dir);
    const wasmB = wasmA.replace(/-[^-.]+\.wasm$/, "-BUILDBBB.wasm");
    const B = makeBuild(A.dir, "B", (dir) => {
      renameSync(join(dir, "assets", wasmA), join(dir, "assets", wasmB));
      for (const f of readdirSync(join(dir, "assets")).filter((n) => n.endsWith(".js"))) {
        const p = join(dir, "assets", f);
        const s = readFileSync(p, "utf8");
        if (s.includes(wasmA)) writeFileSync(p, s.split(wasmA).join(wasmB));
      }
    });
    assert.notEqual(A.info.version, B.info.version);
    assert.ok(B.info.precache.includes(`assets/${wasmB}`) && !B.info.precache.includes(`assets/${wasmA}`));

    site.root = A.dir;
    const context = await browser.newContext({ viewport: viewports[1280], hasTouch: true, serviceWorkers: "allow" });
    // Which .wasm each tab's kernel loaded (the worker's requests, answered by the service worker or not).
    const wasmSeen = [];
    context.on("request", (r) => r.url().endsWith(".wasm") && !r.serviceWorker() && wasmSeen.push(r.url().split("/").pop())); // not the service worker's own (installing a version)
    try {
      const one = await context.newPage();
      one.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
      await one.goto(`${app}?test-hooks`);
      await kernelUp(one);
      await one.evaluate(() => navigator.serviceWorker.ready);
      await one.reload(); // now controlled by A's worker
      await controlled(one);
      await kernelUp(one);
      await startWithBox(one);
      const two = await context.newPage();
      await two.setViewportSize(viewports[375]);
      await two.goto(`${app}?test-hooks`);
      await kernelUp(two);
      await controlled(two);

      // B goes up. A reload still gives all of A, and offers B.
      site.root = B.dir;
      wasmSeen.length = 0;
      await one.reload();
      await kernelUp(one);
      assert.equal(await buildMark(one), "A", "the reload still gives the version in use");
      assert.deepEqual([...new Set(wasmSeen)], [wasmA], "A's page loaded A's kernel");
      await one.waitForSelector('#app-update[data-kind="ready"]', { timeout: 20000 });
      assert.equal(await one.textContent("#app-update span"), "A new version of SpindleLabs is ready.");
      if (shots) await one.screenshot({ path: `${shots}/update-ready-1280.png` });

      wasmSeen.length = 0;
      await Promise.all([one.waitForNavigation(), one.click("#app-update-reload")]);
      await kernelUp(one);
      assert.equal(await buildMark(one), "B");
      assert.deepEqual([...new Set(wasmSeen)], [wasmB], "B's page loaded B's kernel, never A's");
      // kernel_version answered (kernelUp), so the kernel's handshake with its kernel.json passed; the box came back.
      await one.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³", null, { timeout: 15000 });
      assert.deepEqual((await ourCaches(one)).sort(), [`spindlelabs-${A.info.version}`, `spindlelabs-${B.info.version}`].sort());

      // The other tab, still on A, is told, and its Reload (a tap) gives B.
      await two.waitForSelector('#app-update[data-kind="elsewhere"]', { timeout: 20000 });
      assert.equal(await two.textContent("#app-update span"), "SpindleLabs was updated in another tab.");
      const box = await two.$eval("#app-update", (e) => e.getBoundingClientRect().toJSON());
      assert.ok(box.left >= 0 && box.right <= 375, `the notice fits 375 px (${box.left}…${box.right})`);
      if (shots) await two.screenshot({ path: `${shots}/update-elsewhere-375.png` });
      // Until then it still finds its own build's files, gone from the server (a 404 there), in A's cache:
      // a kernel restart in that tab loads A's kernel again (real-use hunt A2).
      assert.equal(await two.evaluate((p) => fetch(p).then((r) => r.status), `assets/${wasmA}`), 200, "the old tab's own .wasm, from A's cache");
      assert.equal(await two.evaluate(() => fetch("assets/nothing-here.js").then((r) => r.status)), 404, "a file no build has is still a 404");
      await Promise.all([two.waitForNavigation(), two.tap("#app-update-reload")]);
      await kernelUp(two);
      assert.equal(await buildMark(two), "B");

      // C: A's cache goes, B's stays (a tab may still be on it).
      const C = makeBuild(B.dir, "C");
      site.root = C.dir;
      await one.reload();
      await one.waitForSelector('#app-update[data-kind="ready"]', { timeout: 20000 });
      await Promise.all([one.waitForNavigation(), one.click("#app-update-reload")]);
      await kernelUp(one);
      assert.equal(await buildMark(one), "C");
      await two.waitForSelector('#app-update[data-kind="elsewhere"]', { timeout: 20000 });
      await Promise.all([two.waitForNavigation(), two.tap("#app-update-reload")]);
      await kernelUp(two);
      assert.deepEqual((await ourCaches(one)).sort(), [`spindlelabs-${B.info.version}`, `spindlelabs-${C.info.version}`].sort());

      // D: its list names a file the server doesn't have, so it never installs: no notice, C runs on.
      const D = makeBuild(C.dir, "D");
      writeFileSync(join(D.dir, "sw.js"), serviceWorkerSource({ ...D.info, precache: [...D.info.precache, "assets/missing.js"] }));
      site.root = D.dir;
      await one.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
        const next = reg.installing;
        if (next) await new Promise((done) => next.addEventListener("statechange", () => next.state === "redundant" || next.state === "installed" ? done() : null));
      });
      assert.equal(await one.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting), null, "D never installed");
      assert.equal(await one.$("#app-update"), null, "no notice for a build that didn't install");
      await one.reload();
      await kernelUp(one);
      assert.equal(await buildMark(one), "C", "still C, whole");
      await one.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³", null, { timeout: 15000 });
    } finally {
      await context.close();
      site.root = DIST;
    }
  });
} finally {
  await browser.close();
  if (site.server?.listening) await stopServer();
  rmSync(work, { recursive: true, force: true });
}
if (failed) {
  console.log(`${failed} offline check(s) failed`);
  process.exit(1);
}
console.log("offline: all checks passed");
