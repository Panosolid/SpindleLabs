// Browser check of a sketch on a moved face (35e2h): the box moved up 5,
// a sketch made on its top (picked in the view, as a person would) with a
// 20 × 10 rectangle extruded 10, then Move 1 edited to slide the box 20
// along x too: the sketch, and so its extrude, slides with the top (before
// 35e2h it stayed where it was drawn and only followed the top's height).
// The STL's bounds, worked by hand: as drawn the box spans x 0..40,
// y 0..30, z 5..25 and the block x 10..30, y 10..20, z 25..35, so the
// whole is x 0..40, y 0..30, z 5..35; slid 20, the box is x 20..60 and the
// block x 30..50, so x 20..60 (left behind, the block would make it 10..60).
// Then the block's own pixels: the middle of where it went is the block,
// not the empty top. 1280 px with a mouse and 375 px with taps. Screenshots
// go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, gridSnapOn, openPanel, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4251, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4251/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
  await nextFrame(page);
}

// The pinhole camera (face-sketch.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field of view.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
function toScreen(cam, box, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const aspect = box.width / box.height;
  const nx = dot(v, right) / (dot(v, forward) * T * aspect);
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
/** Clicks (or taps) the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p, tap = false) {
  await closePanels(page, tap);
  const s = toScreen(await camera(page), await canvasBox(page), p);
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
/** Waits until the camera holds still. */
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((x, k) => Math.abs(x - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}

/** The toolbar's STL: [min, max] of its corners for x, y and z (mm). */
async function stlBounds(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  const pts = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
  return [0, 1, 2].map((i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))]);
}
const near = (got, want, what) => got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-3, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const opened = (page) => until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
const closed = (page) => until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");

async function fresh(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

/** Move 1's Edit feature, from its timeline item's menu (right-click, or its ⋯ on a phone). */
async function editMove(page, tap) {
  const item = page.locator('#timeline [data-item="feature-2"]');
  if (tap) {
    if (!(await page.isVisible('#timeline [data-more="feature-2"]'))) await (await closePanels(page, true), item.tap());
    await page.tap('#timeline [data-more="feature-2"]');
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
  await press(page, "#row-menu-edit", tap);
  await opened(page);
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: a sketch on the top of a moved box slides with it when the Move is edited to slide it along x`, async () => {
      const page = await fresh(width, height, tap);
      try {
        // Move 1: Box 1 picked by its Bodies row, up 5.
        await openPanel(page, "browser", tap);
        await press(page, '#browser [data-node="bodies"] .tree-row', tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Box 1 selected");
        await closePanels(page, tap);
        await page.evaluate(() => document.activeElement?.blur());
        if (tap) await press(page, "#move", tap);
        else await page.keyboard.press("m");
        await opened(page);
        await page.fill("#move-z", "5");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        // A sketch on the top (now z = 25), picked from the top view, a 20 × 10 rectangle from (10, 10) to (30, 20), extruded 10.
        await press(page, '[data-view="top"]', tap);
        await settle(page);
        await press(page, "#create-sketch", tap);
        await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
        await at(page, [20, 15, 25], tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
        await settle(page);
        await openPanel(page, "properties", tap);
        await gridSnapOn(page);
        await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
        const corners = [[30, 20, 25], [10, 20, 25], [10, 10, 25], [30, 10, 25]];
        if (!tap) for (const p of [...corners, corners[0]]) await at(page, p);
        else {
          await page.tap("#sketch-tool-rectangle");
          for (const p of [corners[2], corners[0]]) await at(page, p, true);
        }
        await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "closed outline");
        await openPanel(page, "properties", tap);
        await press(page, "#sketch-extrude", tap);
        await page.fill("#extrude-distance", "10");
        await press(page, "#extrude-ok", tap);
        await until(page, () => document.querySelector("#volume")?.textContent === "2,000 mm³", null, "the 20 · 10 · 10 block");
        await rebuilt(page);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [5, 35]], "as drawn");
        // Move 1 edited to slide 20 along x as well: the block goes with the top.
        await editMove(page, tap);
        await page.fill("#move-x", "20");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[20, 60], [0, 30], [5, 35]], "slid with the top (left behind it would reach back to x 10)");
        if (shots) await page.screenshot({ path: `${shots}/move-face-sketch-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  failed++;
  console.log(`not ok - no page errors\n  ${errors.join("\n  ")}`);
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
