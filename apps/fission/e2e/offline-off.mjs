// Browser check of the build with offline mode OFF (offline.config.mjs), the
// one that ships until offline mode is released:
// - No service worker is registered and nothing is cached, and the page has
//   no manifest link, so the browser offers no install.
// - A browser that already has the old worker (a copy of the build with the
//   real offline worker, installed and caching, controlling the page) is
//   cleaned: on the next load the worker is gone, its caches are gone, and
//   the page was reloaded once. Without the page's own help, the worker the
//   site now serves as sw.js (the clean-up worker) does the same when the
//   browser looks for an update.
// Needs the normal build (`npm run build`); `npm run e2e:offline` checks the
// build with offline mode on (e2e/offline.mjs).
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { writeServiceWorker } from "../offline.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(join(DIST, "sw.js"))) throw new Error("build the app first (npm run build): dist/sw.js is missing");
if (readFileSync(join(DIST, "sw.js"), "utf8").startsWith("self.__SPINDLELABS_BUILD__")) {
  console.log("offline-off: skipped, this build has offline mode on");
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "offline-off-e2e-"));
const KILL = readFileSync(join(DIST, "sw.js"), "utf8");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const site = { root: DIST, server: null, port: 4241 };
function startServer() {
  site.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
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
const app = `http://127.0.0.1:${site.port}/`;

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
const kernelUp = (page) => page.waitForFunction(() => /kernel v/.test(document.querySelector("#version")?.textContent ?? ""), null, { timeout: 20000 });
const state = (page) =>
  page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    caches: (await caches.keys()).filter((k) => k.startsWith("spindlelabs-")),
    controlled: navigator.serviceWorker.controller !== null,
  }));
/** Waits (up to 20 s) until nothing of the old install is left; the page may be reloading meanwhile. */
async function untilClean(page) {
  let last;
  for (let i = 0; i < 80; i++) {
    try {
      last = await state(page);
      if (last.registrations === 0 && last.caches.length === 0) return;
    } catch {
      // the page is reloading
    }
    await page.waitForTimeout(250);
  }
  assert.fail(`the old install was not removed: ${JSON.stringify(last)}`);
}
const newApp = async (serviceWorkers = "allow") => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  return { context, page };
};
/** The old install: the real offline worker registered and caching, a page controlled by it (the privacy page, which runs no app code, so the app's own clean-up has not run yet). */
async function installOld(page) {
  await page.goto(`${app}privacy.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  const s = await state(page);
  assert.equal(s.registrations, 1);
  assert.equal(s.caches.length, 1, "the old worker's cache exists");
}

try {
  await startServer();
  // The site as it was before: the same build with the real offline worker as sw.js.
  const old = join(work, "old") + "/";
  cpSync(DIST, old, { recursive: true });
  writeServiceWorker(old);

  await check("a visitor with nothing installed: no service worker, no cache, no manifest link", async () => {
    const { context, page } = await newApp();
    try {
      await page.goto(`${app}?test-hooks`);
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
      assert.equal(await page.$('link[rel="manifest"]'), null, "no manifest, so no install offer");
      await page.reload();
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
    } finally {
      await context.close();
    }
  });

  await check("an old install is removed by the page on the next load: worker gone, cache gone, live copy opened", async () => {
    site.root = old;
    const { context, page } = await newApp();
    try {
      await installOld(page);
      site.root = DIST; // the site now ships offline mode off
      // The page's own clean-up first: stop the browser fetching the clean-up worker by blocking sw.js here.
      await page.route("**/sw.js", (route) => route.abort());
      await page.goto(`${app}?test-hooks`); // opened from the old cache: controlled, so it cleans up and reloads once
      await untilClean(page);
      await page.unroute("**/sw.js");
      await kernelUp(page);
      assert.deepEqual(await state(page), { registrations: 0, caches: [], controlled: false });
    } finally {
      await context.close();
      site.root = DIST;
    }
  });

  await check("an old install is removed by the clean-up worker alone when the browser looks for an update", async () => {
    site.root = old;
    const { context, page } = await newApp();
    try {
      await installOld(page);
      site.root = DIST;
      // What the old page does on every visit: look for a new sw.js. It finds the clean-up worker.
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
      });
      await untilClean(page);
    } finally {
      await context.close();
      site.root = DIST;
    }
  });

  await check("the clean-up worker is the one the build ships as sw.js, and keeps nothing", async () => {
    assert.ok(!KILL.includes("__SPINDLELABS_BUILD__"));
    assert.ok(!/addEventListener\("fetch"/.test(KILL), "no fetch handler: every request goes to the network");
  });
} finally {
  await browser.close();
  if (site.server?.listening) {
    site.server.closeAllConnections();
    site.server.close();
  }
  rmSync(work, { recursive: true, force: true });
}
if (failed) {
  console.log(`${failed} offline-off check(s) failed`);
  process.exit(1);
}
console.log("offline-off: all checks passed");
