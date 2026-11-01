// Browser check of the build area (Ben, 2026-11-01): the Origin folder's
// "Build area (P1S)" row has an eye, shut at first; opened, the view draws
// the P1S's printable box under the 40 × 30 × 20 mm box (fits); widened to
// 300 mm the box goes red and a note says why (256 mm fits), without
// covering the view's buttons; the choice is kept on reload; shut again,
// nothing is drawn. No undo step: it is a view setting, not a design change.
// At a desktop width with clicks and a phone's with taps.
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { openPanel, reloadEmpty, startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

const server = await preview({ preview: { port: 4207, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4207/";
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
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

const eye = '#browser [data-eye="origin-build-area"]';
const area = (page) => page.evaluate(() => document.querySelector("[data-build-area]")?.dataset.buildArea ?? null);

for (const [width, height, tap] of [[1280, 800, false], [393, 852, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: the build area's eye in Origin shows the P1S box, red with a note when the part is too wide, kept on reload`, async () => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await page.goto(url);
      await startWithBox(page, tap);
      const openOrigin = async () => {
        await openPanel(page, "browser", tap);
        if (!(await page.isVisible(eye))) await press('#browser details[data-node="origin"] > summary');
        await page.locator(eye).waitFor();
      };
      await openOrigin();
      // Shut at first: nothing drawn, the row dimmed.
      assert.equal(await area(page), null);
      const undoBefore = await page.getAttribute("#undo", "title");
      await press(eye);
      await page.waitForFunction(() => document.querySelector("[data-build-area]")?.dataset.buildArea === "fits");
      assert.equal(await page.isVisible(".build-area"), false, "no note while the part fits");
      assert.equal(await page.getAttribute("#undo", "title"), undoBefore, "no undo step for a view setting");
      if (shots) await page.screenshot({ path: `${shots}/build-area-${width}-fits.png` });
      // 300 mm wide: too big for the 256 mm plate.
      await pinProperties(page);
      await openPanel(page, "properties", tap);
      await page.fill("#width", "300");
      await page.press("#width", "Enter");
      await page.waitForFunction(() => document.querySelector("[data-build-area]")?.dataset.buildArea === "outside");
      const words = await page.textContent(".build-area");
      assert.equal(words, "Too big for the P1S's plate: the bodies shown are 300 mm wide (256 × 256 mm fits).");
      // The note never covers the view's own buttons.
      const note = await page.locator(".build-area").boundingBox();
      const controls = await page.locator("#view-controls").boundingBox();
      if (controls) assert.ok(note.y + note.height <= controls.y + 0.5 || note.y >= controls.y + controls.height - 0.5, `note ${JSON.stringify(note)} over the view controls ${JSON.stringify(controls)}`);
      if (tap) await page.evaluate(() => document.querySelector("#properties-toggle")?.getAttribute("aria-expanded") === "true" && document.querySelector("#properties-toggle").click());
      if (shots) await page.screenshot({ path: `${shots}/build-area-${width}-outside.png` });
      // Kept on reload (this browser's setting): a new part shows it at once.
      await reloadEmpty(page);
      await startWithBox(page, tap);
      await page.waitForFunction(() => document.querySelector("[data-build-area]")?.dataset.buildArea === "fits");
      // Shut again: gone.
      await openOrigin();
      await press(eye);
      await page.waitForFunction(() => !document.querySelector("[data-build-area]"));
      assert.equal(await page.isVisible(".build-area"), false);
    } finally {
      await context.close();
    }
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) process.exit(1);
