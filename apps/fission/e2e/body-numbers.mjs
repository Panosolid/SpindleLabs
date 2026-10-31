// Browser check of step 35e (35ea): a body keeps the number it was given
// when it first appeared ("Body 2"), stored with the project. A box (Body 1)
// and a cylinder (Body 2) inserted; the box suppressed from the timeline
// bar's menu leaves the cylinder's row "Body 2" (before 35e it became
// "Body 1", numbered by place); undone, both rows are back. The cylinder
// deleted and a sphere inserted: the sphere is Body 3, never Body 2 again.
// A reload keeps every number. At 1280 px with clicks and 375 px with taps;
// screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, insertPreset, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4263, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4263/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const bodyRows = (page) => page.$$eval('[data-node="bodies"] .tree-row', (rows) => rows.map((r) => `${r.dataset.node} ${r.textContent.trim()}`));
/** Waits until the Bodies rows read `want` (the browser draws again when a rebuild lands). */
const rowsAre = (page, want, what) => until(page, (w) => JSON.stringify([...document.querySelectorAll('[data-node="bodies"] .tree-row')].map((r) => `${r.dataset.node} ${r.textContent.trim()}`)) === w, JSON.stringify(want), what);
const rebuilt = async (page) => {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

for (const [width, tap] of [[1280, false], [375, true]]) {
  await check(`a body keeps its number through a suppress, a delete and a reload (${width} px${tap ? ", taps" : ""})`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: tap });
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("kept")) indexedDB.deleteDatabase("fission");
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(url + "#design");
    await startWithBox(page, tap);
    await insertPreset(page, "cylinder", tap);
    await rowsAre(page, ["body-1 Body 1", "body-2 Body 2"], "box and cylinder");

    /** Item `id`'s menu from the timeline bar, then `action` in it. */
    const fromBar = async (id, action) => {
      const item = page.locator(`#timeline [data-item="${id}"]`);
      await rebuilt(page);
      await item.scrollIntoViewIfNeeded();
      if (tap) {
        await closePanels(page, true);
        await item.tap();
        await page.tap(`#timeline [data-more="${id}"]`);
      } else await item.click({ button: "right" });
      await until(page, () => document.getElementById("row-menu").open, null, `${id}'s menu`);
      await press(page, `#row-menu-${action}`, tap);
      await until(page, () => !document.getElementById("row-menu").open, null, "the menu closed");
    };
    const browserOpen = async () => {
      if ((await page.isVisible("#browser-toggle")) && (await page.getAttribute("#browser-toggle", "aria-expanded")) !== "true") await press(page, "#browser-toggle", tap);
      await page.evaluate(() => document.querySelectorAll("#browser details").forEach((d) => (d.open = true)));
    };
    const browserClosed = async () => {
      if ((await page.isVisible("#browser-toggle")) && (await page.getAttribute("#browser-toggle", "aria-expanded")) === "true") await press(page, "#browser-toggle", tap);
    };

    // The box (feature-1) suppressed: the cylinder's row stays Body 2.
    await fromBar("feature-1", "suppress");
    await rowsAre(page, ["body-2 Body 2"], "the cylinder still Body 2 with the box suppressed");
    await browserOpen();
    await page.locator('[data-node="bodies"] [data-node="body-2"]').scrollIntoViewIfNeeded();
    assert.equal(await page.isVisible('[data-node="bodies"] [data-node="body-2"]'), true, "its row shows");
    if (shots) await page.screenshot({ path: `${shots}/suppressed-keeps-2-${width}.png` });
    await browserClosed();
    // Undone: both rows again, numbered as before.
    await press(page, "#undo", tap);
    await rowsAre(page, ["body-1 Body 1", "body-2 Body 2"], "undone");

    // The cylinder (feature-2) deleted, a sphere inserted: Body 3.
    await fromBar("feature-2", "delete");
    await rowsAre(page, ["body-1 Body 1"], "the cylinder deleted");
    await insertPreset(page, "sphere", tap);
    await rowsAre(page, ["body-1 Body 1", "body-3 Body 3"], "the sphere is Body 3, not Body 2 again");
    await browserOpen();
    await page.locator('[data-node="bodies"] [data-node="body-3"]').scrollIntoViewIfNeeded();
    assert.equal(await page.isVisible('[data-node="bodies"] [data-node="body-3"]'), true, "its row shows");
    if (shots) await page.screenshot({ path: `${shots}/new-body-3-${width}.png` });
    // The phone rule: the open drawer leaves most of the view uncovered.
    if (width === 375) {
      const drawer = await page.locator("#browser").boundingBox();
      assert.ok(drawer && drawer.width * drawer.height < 0.5 * 375 * 800, `the browser covers ${JSON.stringify(drawer)}`);
    }
    await browserClosed();

    // Stored: a reload reads the same numbers back.
    await page.evaluate(() => sessionStorage.setItem("kept", "1"));
    await page.reload();
    await rowsAre(page, ["body-1 Body 1", "body-3 Body 3"], "kept on reload");
    if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
    await context.close();
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
