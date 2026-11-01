// Browser check of the size boxes following the selected body (Move/timeline
// bug hunt 2026-11-01: with Body 1 selected the panel named Body 1 but the
// Width box showed, and typing changed, the last body). Two boxes inserted,
// Box 2 typed 60 wide; Body 1's row selected: the Width box reads 40 (Box 1's)
// and typing 50 makes Box 1 50 wide (50 · 30 · 20 = 30,000 mm³) while Box 2
// keeps 60; Escape: the boxes are Box 2's 60 again. At 1280 px with clicks and
// 375 px with taps; screenshots go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, insertPreset, openPanel, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4291, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4291/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const panel = (page) =>
  page.evaluate(() => ({
    intent: document.querySelector("#intent")?.textContent,
    volume: document.querySelector("#volume")?.textContent,
    width: document.querySelector("#width")?.value,
    depth: document.querySelector("#depth")?.value,
    height: document.querySelector("#height")?.value,
  }));
const volumeIs = (page, v, what) => until(page, (v) => document.querySelector("#volume")?.textContent === v, v, what);

/** Opens (`open`) or closes the browser: a drawer at phone width, the floating panel's fold on a wide screen. */
async function foldBrowser(page, open, tap) {
  if (await page.isVisible("#browser-toggle")) {
    if ((await page.getAttribute("#browser-toggle", "aria-expanded")) !== String(open)) await press(page, "#browser-toggle", tap);
  }
  if (open) await page.evaluate(() => document.querySelector('#browser [data-node="bodies"]')?.closest("details")?.setAttribute("open", ""));
}

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
  await check(`the size boxes are the selected body's, and change it (${width} px${tap ? ", taps" : ""})`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: tap });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(url + "#design");
    await startWithBox(page, tap);
    await closePanels(page, tap);
    await insertPreset(page, "box", tap);
    await openPanel(page, "properties", tap);
    await page.fill("#width", "60");
    // Box 2: 60 · 30 · 20 = 36,000 mm³.
    await volumeIs(page, "36,000 mm³", "Box 2 60 wide");

    await closePanels(page, tap);
    await foldBrowser(page, true, tap);
    await press(page, '#browser [data-node="body-1"]', tap);
    await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Body 1 selected");
    await foldBrowser(page, false, tap);
    await openPanel(page, "properties", tap);
    // Box 1, 40 · 30 · 20 = 24,000 mm³, and its boxes 40 × 30 × 20, never Box 2's 60.
    await volumeIs(page, "24,000 mm³", "Body 1's volume");
    assert.deepEqual(await panel(page), { intent: "Box: 40 × 30 × 20 mm", volume: "24,000 mm³", width: "40", depth: "30", height: "20" });
    if (shots) await page.screenshot({ path: `${shots}/parameters-follow-${width}-body1.png` });

    await page.fill("#width", "50");
    // Box 1 now 50 · 30 · 20 = 30,000 mm³.
    await volumeIs(page, "30,000 mm³", "Box 1 50 wide");
    assert.deepEqual(await panel(page), { intent: "Box: 50 × 30 × 20 mm", volume: "30,000 mm³", width: "50", depth: "30", height: "20" });
    if (shots) await page.screenshot({ path: `${shots}/parameters-follow-${width}-typed.png` });

    // Nothing selected: Box 2, still 60 wide.
    await closePanels(page, tap);
    await page.keyboard.press("Escape");
    await until(page, () => (document.body.dataset.selection ?? "") === "", null, "selection cleared");
    await openPanel(page, "properties", tap);
    await volumeIs(page, "36,000 mm³", "Box 2 kept 60");
    assert.deepEqual(await panel(page), { intent: "Box: 60 × 30 × 20 mm", volume: "36,000 mm³", width: "60", depth: "30", height: "20" });
    if (shots) await page.screenshot({ path: `${shots}/parameters-follow-${width}-last.png` });
    await context.close();
  });
}

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
