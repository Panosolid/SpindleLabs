// Browser check of the kernel lost to an update or a failing network (app
// blind spots B2; Ben's phone project, 2026-10-28: back to a tab left open,
// every item that needs the kernel red). The site is served as GitHub Pages
// serves it (live-site.mjs), so a deploy really removes the old build's
// files. Three ways the kernel's files go missing, each must end with the
// design kept and built again, never items left red with no way back:
// - a new build is deployed while the page is open, then the kernel has to
//   start again (it ran out of memory, kernel-restart.mjs): its old files
//   are gone, so the app says SpindleLabs was updated and offers Reload;
//   Reload opens the new build with the design as it was, nothing red;
// - the kernel's .wasm fails to download once (a phone's network blinking):
//   the app tries again by itself, and nothing is red or said;
// - it keeps failing: the app says the engine couldn't download and offers
//   Try again, which (with the network back) builds the design, no reload.
// And the app opened on a build a deploy has since replaced, kept by the
// browser (Ben's phone, 2026-10-30: last session's body red at open, and
// "updated" said, until a reload): before the user touches anything the
// app opens the new build by itself, the body built and nothing said,
// whether the old kernel file is gone or was kept too; a browser that
// keeps handing over the old page gets one reload, then the notice, never
// a loop.
// 393 px (Ben's phone) and 1280 px; `E2E_SHOTS` saves screenshots.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch, untilBodies } from "./browser.mjs";
import { liveSite } from "./live-site.mjs";

const UPDATED = "SpindleLabs was updated while this page was open. Reload to get the new version; your design is kept."; // src/kernel-lost.ts
const UNREACHABLE = "The geometry engine couldn't download, so parts can't be built. Check the connection; your design is kept."; // src/kernel-lost.ts
const project = readFileSync(new URL("./regressions/phone-project-all-red.spindle", import.meta.url));
const ALL = ["sketch-1", "feature-10", "sketch-11", "sketch-12", "feature-35", "sketch-36", "feature-42", "feature-43"];
const BODIES = 4; // one kept body per feature, as a page that never lost its kernel holds once it has built (the first check)
const RED = ["feature-10", "feature-35", "feature-42", "feature-43"]; // what a lost kernel turns red: the features; the sketches draw without it
const browser = await launch();
const shots = process.env.E2E_SHOTS;
let failed = false;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

const rebuilt = (page) => page.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, { timeout: 15000 });
const items = (page) => page.$$eval("#timeline li[data-item]", (lis) => lis.map((li) => ({ id: li.dataset.item, failed: li.dataset.failed === "true" })));
const red = async (page) => (await items(page)).filter((i) => i.failed).map((i) => i.id);
const open = async (page) => {
  await page.setInputFiles("#open-file", { name: "phone.spindle", mimeType: "application/octet-stream", buffer: project });
  await page.waitForTimeout(300);
  await rebuilt(page);
};
const noneRed = async (page, when) => {
  assert.deepEqual((await items(page)).map((i) => i.id), ALL, `${when}: the items`);
  assert.deepEqual(await red(page), [], `${when}: no item red`);
};
const notice = async (page, kind) => {
  await page.waitForSelector(`#app-update[data-kind="${kind}"]`, { timeout: 20000 });
  return page.textContent("#app-update span");
};
const screen = (width) => (width === 393 ? { viewport: { width, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } : { viewport: { width, height: 800 } });

let port = 4241;
for (const width of [393, 1280]) {
  await check(`${width} px: a deploy while the page is open, then the kernel starts again: "updated", Reload keeps the design`, async () => {
    const site = await liveSite(port++, { capMib: 25 });
    const context = await browser.newContext(screen(width));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${site.url}?test-hooks`);
      await page.waitForFunction(() => window.fissionTest !== undefined);
      await open(page);
      await noneRed(page, "opened");
      await untilBodies(page, BODIES, "the project's bodies on a working kernel");
      const held = BODIES;
      await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved", null, { timeout: 15000 });

      site.deploy();
      // The kernel runs out of memory: the restart asks for the old build's kernel, which is gone.
      await page.evaluate(async () => {
        for (let r = 1; r < 100000; r++) {
          try {
            await window.fissionTest.kernelCall("body_build", { sphere: { radius: r } });
          } catch {
            return;
          }
        }
      });
      assert.equal(await notice(page, "updated"), UPDATED);
      assert.deepEqual(await red(page), RED, "the kernel's items are red while the page is on the old build");
      if (shots) await page.screenshot({ path: `${shots}/app-updated-${width}.png` });

      await Promise.all([page.waitForNavigation(), page.click("#app-update-reload")]);
      await page.waitForFunction(() => window.fissionTest !== undefined);
      await page.waitForFunction((n) => document.querySelectorAll("#timeline li[data-item]").length === n, ALL.length, { timeout: 20000 });
      await rebuilt(page);
      await noneRed(page, "after Reload, on the new build");
      await untilBodies(page, held, "every body built on the new build's kernel");
      assert.equal(await page.$("#app-update"), null, "no notice on the new build");
      assert.deepEqual(errors, [], "no uncaught errors");
    } finally {
      await context.close();
      await site.close();
    }
  });

  for (const { name, wasm, staleEveryTime } of [
    { name: "its kernel file gone: the new build opens by itself, the body built, nothing said", wasm: false, staleEveryTime: false },
    { name: "its kernel kept too: the new build opens by itself, nothing said", wasm: true, staleEveryTime: false },
    { name: "the browser keeps giving the old page: one reload, then the notice, no loop", wasm: false, staleEveryTime: true },
  ]) {
    await check(`${width} px: opened on an old build the browser kept, ${name}`, async () => {
      const site = await liveSite(port++);
      const context = await browser.newContext(screen(width));
      const seen = [];
      await context.exposeFunction("noticeSeen", (kind) => seen.push(kind));
      await context.addInitScript(() => {
        new MutationObserver(() => {
          const box = document.getElementById("app-update");
          if (box && !box.dataset.seen) {
            box.dataset.seen = "1";
            window.noticeSeen(box.dataset.kind);
          }
        }).observe(document, { childList: true, subtree: true });
      });
      try {
        // Last session, on the build live then: the project opened and saved.
        const before = await context.newPage();
        await before.goto(`${site.url}?test-hooks`);
        await before.waitForFunction(() => window.fissionTest !== undefined);
        await open(before);
        await noneRed(before, "last session");
        await before.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved", null, { timeout: 15000 });
        await before.close();
        const kept = site.browserCache({ wasm });
        site.deploy();

        // Today: the browser hands over the page it kept (the first load, or every load) and the files it kept; the rest comes from the site.
        let loads = 0;
        await context.route("**/*", (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          const page = request.isNavigationRequest() && path === "/";
          if (page) loads++;
          // The app's own look at the page asks past every cache (kernel-lost.ts), so only a page load gets the kept page.
          const file = path === "/" && !page ? undefined : kept.get(path);
          if (file && (!page || loads === 1 || staleEveryTime)) return route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
          return route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${site.url}?test-hooks`);
        if (staleEveryTime) {
          assert.equal(await notice(page, "updated"), UPDATED);
          await page.waitForTimeout(3000); // time for any further reload to show
          assert.equal(loads, 2, "one reload, no more");
          assert.deepEqual(seen, ["updated"], "the notice once, on the second load");
          return;
        }
        await page.waitForFunction(() => [...document.scripts].some((s) => /v1\.js$/.test(s.src)), null, { timeout: 20000 });
        await page.waitForFunction(() => window.fissionTest !== undefined);
        await page.waitForFunction((n) => document.querySelectorAll("#timeline li[data-item]").length === n, ALL.length, { timeout: 20000 });
        await rebuilt(page);
        await noneRed(page, "opened on the new build");
        await untilBodies(page, BODIES, "every body built on the new build's kernel");
        if (shots) await page.screenshot({ path: `${shots}/fresh-open-${wasm ? "kept" : "gone"}-${width}.png` });
        assert.equal(loads, 2, "the old page, then the new build: one reload");
        await page.waitForTimeout(1000);
        assert.deepEqual(seen, [], "no notice at any point");
        assert.deepEqual(errors, [], "no uncaught errors");
      } finally {
        await context.close();
        await site.close();
      }
    });
  }

  await check(`${width} px: the kernel's file fails to download once: tried again by itself, nothing red or said`, async () => {
    const site = await liveSite(port++);
    const context = await browser.newContext(screen(width));
    const page = await context.newPage();
    try {
      site.dropKernel(1);
      await page.goto(`${site.url}?test-hooks`);
      await page.waitForFunction(() => window.fissionTest !== undefined);
      await open(page);
      await noneRed(page, "opened");
      assert.equal(site.kernelRequests(), 2, "the kernel was asked for twice: the dropped try and the next");
      assert.equal(await page.$("#app-update"), null, "nothing said");
    } finally {
      await context.close();
      await site.close();
    }
  });

  await check(`${width} px: the kernel's file keeps failing: "couldn't download", Try again builds the design without a reload`, async () => {
    const site = await liveSite(port++);
    const context = await browser.newContext(screen(width));
    const page = await context.newPage();
    try {
      site.dropKernel(Infinity);
      await page.goto(`${site.url}?test-hooks`);
      await page.waitForFunction(() => window.fissionTest !== undefined);
      assert.equal(await notice(page, "unreachable"), UNREACHABLE);
      await open(page);
      assert.deepEqual(await red(page), RED, "the kernel's items are red while it can't download");
      if (shots) await page.screenshot({ path: `${shots}/kernel-unreachable-${width}.png` });

      site.dropKernel(0);
      await page.evaluate(() => (window.fissionTestLoaded = true)); // gone if the page reloads
      await page.click("#app-update-reload");
      await page.waitForFunction(() => document.querySelector("#timeline li[data-failed='true']") === null, null, { timeout: 20000 });
      await rebuilt(page);
      await noneRed(page, "after Try again");
      assert.equal(await page.evaluate(() => window.fissionTestLoaded), true, "the same page: no reload");
      await page.waitForSelector("#app-update", { state: "detached" });
      await untilBodies(page, BODIES, "every body built after Try again");
    } finally {
      await context.close();
      await site.close();
    }
  });
}

await browser.close();
if (failed) process.exit(1);
