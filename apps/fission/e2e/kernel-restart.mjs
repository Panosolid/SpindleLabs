// Browser check of the kernel's restart (Ben's phone project, 2026-10-28:
// reopened, every item that needs the kernel was red at once), in a phone's
// conditions: the kernel's memory capped at 25 MiB (kernel-cap.mjs writes
// the cap into the .wasm, so it holds in every engine; CI runs this in
// WebKit, Safari's engine, as well as Chromium), and at 393 px the page
// set up as an iPhone's (three device pixels to a CSS pixel, touch, a
// mobile viewport). Ben's project is opened and builds; then kernel calls
// (?test-hooks) keep bodies until the memory runs out and the call traps.
// The app answers that call with its words, starts a fresh kernel and
// builds the design again on it: no item red, every body back. A box
// inserted by taps builds on the fresh kernel, and opening the project
// again builds it as before (this was the moment every item went red).
// 393 px (Ben's phone) and 1280 px; `E2E_SHOTS` saves screenshots.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserName, launch, untilBodies } from "./browser.mjs";
import { cappedSite } from "./kernel-cap.mjs";
import { insertPreset } from "./start.mjs";

const KERNEL_RESTARTED = "The geometry kernel ran out of memory or stopped on an internal error, so it was started again."; // packages/core/src/kernel/kernel-client.ts
const project = readFileSync(new URL("./regressions/phone-project-all-red.spindle", import.meta.url));
const CAP_MIB = 25;
const site = await cappedSite(CAP_MIB, 4231);
const url = `${site.url}?test-hooks`;
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
/** The timeline's items, each with whether it is drawn red. */
const items = (page) => page.$$eval("#timeline li[data-item]", (lis) => lis.map((li) => ({ id: li.dataset.item, failed: li.dataset.failed === "true" })));
const ALL = ["sketch-1", "feature-10", "sketch-11", "sketch-12", "feature-35", "sketch-36", "feature-42", "feature-43"];
const open = async (page) => {
  await page.setInputFiles("#open-file", { name: "phone.spindle", mimeType: "application/octet-stream", buffer: project });
  // The project's items in the timeline (a slow engine, WebKit on a phone, can take longer than a fixed wait), then
  // its build; noneRed still says what is there if they never come.
  await page.waitForFunction((all) => [...document.querySelectorAll("#timeline li[data-item]")].map((li) => li.dataset.item).join() === all.join(), ALL, { timeout: 15000 }).catch(() => {});
  await rebuilt(page);
};
const noneRed = async (page, when) => {
  const got = await items(page);
  assert.deepEqual(got.map((i) => i.id), ALL, `${when}: the items`);
  assert.deepEqual(got.filter((i) => i.failed).map((i) => i.id), [], `${when}: no item red`);
};

/** An iPhone 15's screen at 393 px (Firefox has no mobile viewport: touch only there); a desktop's at 1280. */
const screen = (width) =>
  width === 393 ? { viewport: { width, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: browserName !== "firefox" } : { viewport: { width, height: 800 } };

for (const width of [393, 1280]) {
  await check(`${browserName}, ${width} px: a kernel that runs out of memory is started again and the project builds on it`, async () => {
    const context = await browser.newContext(screen(width));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.fissionTest !== undefined);
    await open(page);
    await noneRed(page, "opened");
    const held = await page.evaluate(() => window.fissionTest.bodyCount());
    assert.ok(held >= 3, `the three extrudes are held, got ${held}`);

    // Keep ever bigger spheres until the memory runs out: the call that traps answers in the app's words.
    const answer = await page.evaluate(async () => {
      for (let r = 1; r < 100000; r++) {
        try {
          await window.fissionTest.kernelCall("body_build", { sphere: { radius: r } });
        } catch (e) {
          return e.message;
        }
      }
      return "never ran out";
    });
    assert.equal(answer, KERNEL_RESTARTED);
    // The cap held: the kernel ran out at 25 MiB, not at the browser's own limit (a fresh kernel starts far below it).
    const fresh = await page.evaluate(() => window.fissionTest.wasmBytes());
    assert.ok(fresh <= (CAP_MIB * 1024 * 1024) / 2, `the fresh kernel starts small, ${fresh} bytes`);
    // The fresh kernel builds the design again by itself: every body back, nothing red, the part drawn.
    await untilBodies(page, held, `the ${held} bodies built again on the fresh kernel`);
    await rebuilt(page);
    await noneRed(page, "after the restart");
    assert.notEqual(await page.$eval("#viewport", (v) => v.dataset.shape), "none", "the part is drawn");
    if (shots) await page.screenshot({ path: `${shots}/kernel-restart-${width}.png` });
    // A fresh kernel takes calls: a 10 mm box builds (the trapped one failed this, and so every item).
    const h = await page.evaluate(() => window.fissionTest.kernelCall("body_build", { box: { width: 10, depth: 10, height: 10 } }));
    assert.equal(typeof h, "number");
    await page.evaluate((b) => window.fissionTest.kernelCall("body_free", b), h);
    // A box inserted as a person would (by taps on the phone) builds too.
    await insertPreset(page, "box", width === 393);
    await untilBodies(page, held + 1, "the inserted box on the fresh kernel");
    // Opening the project again (what Ben did) builds every item.
    await open(page);
    await noneRed(page, "opened again");
    await untilBodies(page, held, "the same bodies after opening again");
    assert.deepEqual(errors, [], "no uncaught errors");
    await context.close();
  });
}

await browser.close();
await site.close();
if (failed) process.exit(1);
