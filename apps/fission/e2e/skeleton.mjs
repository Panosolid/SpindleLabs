// Browser check of the skeleton placeholders (@fission/ui skeleton.ts, styles/skeleton.css, src/loading.ts;
// Ben's ask, 10-29): with the engine's .wasm held back, index.html's skeleton of the workspace is invisible for
// its first 200 ms, then shows (toolbar groups, browser rows and the view's shapes, over the whole workspace),
// shimmering, with the workspace marked busy; once the engine arrives it goes, and the empty design's start card
// is there. At 1280 px with a mouse and 393 × 852 with touch. A project opened while the kernel is slow shows a
// skeleton over the 3D view until it is built (24,000 mm³), and one opened quickly never shows one. Under
// reduced motion nothing sweeps. A deliberate break (the 200 ms wait taken out) must fail the early-frames rule.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4251, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4251/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

/**
 * A fresh page that records, every frame, each skeleton's opacity and the page's time (window.skeletonFrames),
 * with the engine's .wasm held back until `release()` when `hold` is set, and every kernel call delayed by
 * window.kernelDelay ms.
 */
async function fresh({ width = 1280, height = 800, touch = false, hold = false, reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.addInitScript(() => {
    window.skeletonFrames = [];
    const look = () => {
      for (const el of document.querySelectorAll(".skeleton")) window.skeletonFrames.push({ t: performance.now(), shape: el.classList[1], opacity: Number(getComputedStyle(el).opacity) });
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      const wait = window.kernelDelay ?? 0;
      if (wait > 0) return void setTimeout(() => send.call(this, message, ...rest), wait);
      return send.call(this, message, ...rest);
    };
  });
  let release = () => {};
  if (hold) {
    const held = new Promise((resolve) => (release = resolve));
    await context.route(/\.wasm(\?|$)/, async (route) => {
      await held;
      await route.continue();
    });
  }
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return { page, context, release };
}

const frames = (page, shape) => page.evaluate((s) => window.skeletonFrames.filter((f) => f.shape === s), shape);
/** The early-frames rule: no skeleton is seen (opacity above 0) in the first 180 ms (0.9 × 200 ms) after it went up. */
function unseenEarly(list, from = 0) {
  const early = list.filter((f) => f.t - from < 180);
  const seen = early.filter((f) => f.opacity > 0);
  assert.ok(early.length > 0 || list.length === 0, "frames were sampled in the first 180 ms");
  assert.deepEqual(seen, [], `seen within 180 ms: ${JSON.stringify(seen.slice(0, 3))}`);
}

for (const [width, height, touch] of [[1280, 800, false], [393, 852, true]]) {
  await check(`the engine held back: the skeleton waits 200 ms, shows the workspace's shape, then goes when the engine arrives (${width} px)`, async () => {
    const { page, context, release } = await fresh({ width, height, touch, hold: true });
    try {
      await page.goto(url + "#design", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => getComputedStyle(document.getElementById("app-skeleton")).opacity === "1", null, { timeout: 5000 });
      unseenEarly(await frames(page, "skeleton-app"));
      assert.equal(await page.getAttribute("#workspace", "aria-busy"), "true");
      assert.equal(await page.getAttribute("#app-skeleton", "role"), "status");
      // It covers the workspace, below the top bar, and its shapes shimmer.
      const box = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const s = r("app-skeleton"), w = r("workspace"), t = r("topbar");
        return { s: [s.left, s.top, s.right, s.bottom], w: [w.left, w.top, w.right, w.bottom], topBottom: t.bottom };
      });
      assert.deepEqual(box.s.map(Math.round), box.w.map(Math.round), "the skeleton covers the whole workspace");
      assert.ok(box.s[1] >= box.topBottom - 1, "and leaves the top bar alone");
      const bones = await page.$$eval("#app-skeleton .skeleton-bone", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => getComputedStyle(e).animationName));
      assert.ok(bones.length >= (width > 640 ? 18 : 12), `${bones.length} shapes shown`);
      assert.ok(bones.every((n) => n === "skeleton-sweep"), "every shape shimmers");
      const browserRows = await page.$$eval("#app-skeleton .skeleton-row", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
      assert.equal(browserRows, width > 640 ? 5 : 0, "browser rows on a wide screen, none on a phone");
      if (shots) await page.screenshot({ path: `${shots}/skeleton-start-${width}.png` });
      release();
      await page.waitForSelector("#app-skeleton", { state: "detached", timeout: 15000 });
      assert.equal(await page.getAttribute("#workspace", "aria-busy"), null, "no longer busy");
      await page.waitForSelector("#start-hint:not([hidden])");
      assert.ok((await frames(page, "skeleton-app")).some((f) => f.opacity > 0 && f.opacity < 1), "it faded out, not cut off");
    } finally {
      await context.close();
    }
  });
}

await check("deliberately broken: with the 200 ms wait taken out, the early-frames rule fails", async () => {
  const { page, context, release } = await fresh({ hold: true });
  try {
    // The built stylesheet, served with the wait taken out of every skeleton (shown at once, no fade-in).
    await context.route(/\.css(\?|$)/, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()) + "\n.skeleton { animation: none !important; opacity: 1 !important; }" });
    });
    await page.goto(url + "#design", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const list = await frames(page, "skeleton-app");
    assert.throws(() => unseenEarly(list), /seen within 180 ms/);
    release();
  } finally {
    await context.close();
  }
});

/** A saved project with the 40 × 30 × 20 box, by Save. */
async function boxFile() {
  const { page, context } = await fresh();
  try {
    await page.goto(url + "#design");
    await startWithBox(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
    return await readFile(await download.path());
  } finally {
    await context.close();
  }
}
const file = await boxFile();
const volumeShown = (page, text) => page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text, { timeout: 15000 });

await check("a project opened while the kernel is slow shows a skeleton over the 3D view until it is built", async () => {
  const { page, context } = await fresh();
  try {
    await page.goto(url + "#design");
    await page.waitForSelector("#app-skeleton", { state: "detached" });
    await page.evaluate(() => (window.kernelDelay = 400));
    const opened = await page.evaluate(() => performance.now());
    await page.setInputFiles("#open-file", { name: "box.spindle", mimeType: "application/json", buffer: file });
    await page.waitForFunction(() => { const e = document.querySelector("#viewport > .skeleton-view"); return e !== null && getComputedStyle(e).opacity === "1"; }, null, { timeout: 5000 });
    unseenEarly(await frames(page, "skeleton-view"), opened);
    assert.equal(await page.getAttribute("#viewport > .skeleton-view", "aria-label"), "Opening the project…");
    assert.equal(await page.getAttribute("#viewport", "aria-busy"), "true");
    if (shots) await page.screenshot({ path: `${shots}/skeleton-open-1280.png` });
    await page.waitForSelector("#viewport > .skeleton-view", { state: "detached", timeout: 20000 });
    assert.equal(await page.getAttribute("#viewport", "aria-busy"), null);
    await page.evaluate(() => (window.kernelDelay = 0));
    await volumeShown(page, "24,000 mm³");
  } finally {
    await context.close();
  }
});

await check("a project opened quickly never shows its skeleton", async () => {
  const { page, context } = await fresh();
  try {
    await page.goto(url + "#design");
    await page.waitForSelector("#app-skeleton", { state: "detached" });
    await page.evaluate(() => (window.skeletonFrames = []));
    await page.setInputFiles("#open-file", { name: "box.spindle", mimeType: "application/json", buffer: file });
    await volumeShown(page, "24,000 mm³");
    await page.waitForSelector("#viewport > .skeleton-view", { state: "detached" });
    const list = await frames(page, "skeleton-view");
    assert.ok(list.length > 0, "it was put up (and sampled)");
    assert.equal(Math.max(...list.map((f) => f.opacity)), 0, "never seen");
  } finally {
    await context.close();
  }
});

await check("reduced motion: the shapes are still (no sweep), and still wait 200 ms", async () => {
  const { page, context, release } = await fresh({ hold: true, reducedMotion: "reduce" });
  try {
    await page.goto(url + "#design", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("app-skeleton")).opacity === "1", null, { timeout: 5000 });
    unseenEarly(await frames(page, "skeleton-app"));
    const names = await page.$$eval("#app-skeleton .skeleton-bone", (els) => [...new Set(els.map((e) => getComputedStyle(e).animationName))]);
    assert.deepEqual(names, ["none"]);
    release();
    await page.waitForSelector("#app-skeleton", { state: "detached", timeout: 15000 });
  } finally {
    await context.close();
  }
});

await browser.close();
await server.close();
assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), [], "no errors in the page");
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("skeleton: all checks passed");
