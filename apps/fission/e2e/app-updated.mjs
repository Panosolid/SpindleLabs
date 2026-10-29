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
