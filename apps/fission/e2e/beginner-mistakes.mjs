// Browser check of the beginner play-test's silent outcomes (hunt
// 2026-10-28), each now said in plain words where the person is looking:
// 1. on a phone with Snap to grid, a small circle's second tap rounds onto
//    its centre: the hint by the finger says the grid did it (the panel
//    saying so is in the closed Properties sheet), and nothing is drawn;
// 2. Extrude (or Finish Sketch) pressed with a circle's centre down waits,
//    saying the circle isn't finished; pressed again it goes on without it;
// 3. a width of 0, or an extrude distance of -60, typed in the properties
//    goes back to the last size and says so (Flip named for the -60);
// 4. an outline touching itself is refused in plain words, never "0e0 mm";
// 5. the whole design's STL names the hidden body it leaves out.
// Screenshots at 1280 and 375 px go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { EMPTY_TOP, clickPlane } from "./sketch-screen.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, closePanels, gridSnapOn, insertPreset, openPanel, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4242, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4242/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const hint = (page) => page.evaluate(() => {
  const h = document.getElementById("sketch-hint");
  return h && !h.hidden ? { text: h.textContent, note: h.classList.contains("pointer-hint-note"), box: h.getBoundingClientRect().toJSON() } : null;
});
/** Whether a box is whole on a screen `width` × `height`. */
const fits = (b, width, height) => b.x >= 0 && b.y >= 0 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5;

// The words the app uses (sketch-tool.ts, sketch.ts), checked as the person reads them.
const GRID_ATE_RADIUS = "The grid pulled that point onto the circle's centre, so it has no radius: click further out, make the grid smaller, or turn off Snap to grid.";
const unfinished = (verb) => `The circle isn't finished: click a point on the circle to finish it, or press ${verb} again to go on without it.`;
const TOUCHING = "two of its curves cross, touch or come closer than 0.001 mm; move them apart";

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 640 ? 800 : 667 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.waitForSelector("#start-hint", { state: "visible" });
  return page;
}

/** The XY plane's button: on the bar over the view at phone width (phone-float.ts), the Properties sheet being shut. */
const xyPlane = (tap) => (tap ? "#float-plane-XY" : "#sketch-plane-XY");

/** A new sketch on XY in the empty design, its tool `tool`. */
async function sketchOnXY(page, tap, tool) {
  await press(page, "#create-sketch", tap);
  await press(page, xyPlane(tap), tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await closePanels(page, tap);
  await press(page, `#sketch-tool-${tool}`, tap);
}

let failed = 0;
async function check(name, body) {
  try {
    await body();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

try {
  for (const [width, tap] of [[375, true], [1280, false]]) {
    await check(`a circle the grid pulls onto its centre says so by the pointer, nothing drawn (${width} px${tap ? ", taps" : ""})`, async () => {
      const page = await fresh(width, tap);
      await press(page, "#create-sketch", tap);
      await press(page, xyPlane(tap), tap);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
      await gridSnapOn(page);
      await press(page, "#sketch-tool-circle", tap);
      // The grid is 10 mm: a point 4 mm from the centre rounds to the centre's own node, (0, 0).
      await clickPlane(page, [0, 0], EMPTY_TOP, tap);
      await page.waitForTimeout(200);
      await clickPlane(page, [4, 0], EMPTY_TOP, tap);
      await until(page, (w) => document.getElementById("sketch-hint")?.textContent === w, GRID_ATE_RADIUS, "the hint says the grid ate the radius");
      const h = await hint(page);
      assert.equal(h.note, true, "drawn as a note");
      assert.ok(fits(h.box, width, width > 640 ? 800 : 667), `the note whole on screen: ${JSON.stringify(h.box)}`);
      assert.equal(await text(page, "#sketch-status"), "Nothing drawn yet.");
      assert.equal(await text(page, "#sketch-grid-error"), GRID_ATE_RADIUS, "the panel says it too");
      if (shots) await page.screenshot({ path: `${shots}/grid-ate-radius-${width}.png` });
      // Further out, the circle is drawn and the note goes: 10 mm is the next node.
      await clickPlane(page, [10, 0], EMPTY_TOP, tap);
      await until(page, () => /^1 circle/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the circle drawn");
      assert.equal((await hint(page))?.note ?? false, false, "the note gone");
      if (!tap) assert.ok(!(await page.isVisible("#sketch-grid-error")));
      await page.context().close();
    });

    await check(`Extrude with a circle half drawn waits and says so; pressed again it goes on (${width} px${tap ? ", taps" : ""})`, async () => {
      const page = await fresh(width, tap);
      await sketchOnXY(page, tap, "circle");
      await gridSnapOn(page); // the radius exactly 20 mm, a tap being no finer than a few pixels
      await clickPlane(page, [0, 0], EMPTY_TOP, tap);
      await page.waitForTimeout(150);
      await clickPlane(page, [20, 0], EMPTY_TOP, tap);
      await until(page, () => /^1 circle/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the first circle");
      // A second circle's centre, then Extrude.
      await clickPlane(page, [-30, 20], EMPTY_TOP, tap);
      await page.waitForTimeout(150);
      await press(page, "#extrude", tap);
      // On a phone by the finger (the panel is in the closed sheet); with a mouse, which has gone to the button, in the panel.
      if (tap) await until(page, (w) => document.getElementById("sketch-hint")?.textContent === w, unfinished("Extrude"), "the hint says the circle isn't finished");
      await until(page, (w) => document.getElementById("sketch-grid-error")?.textContent === w, unfinished("Extrude"), "the panel says the circle isn't finished");
      assert.equal(await page.evaluate(() => document.querySelector("#viewport").dataset.sketching), "true", "still sketching");
      assert.ok(!(await page.isVisible("#extrude-panel")), "no Extrude panel yet");
      if (shots) await page.screenshot({ path: `${shots}/unfinished-circle-${width}.png` });
      // Again: Extrude opens, the finished circle chosen, the half-drawn one gone.
      await press(page, "#extrude", tap);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "false", null, "sketch left");
      await openPanel(page, "properties", tap);
      await until(page, () => (document.getElementById("extrude-panel")?.dataset.previewVolume ?? "") !== "", null, "the preview built");
      // π · 20² · 10 = 12,566.37… mm³ (the default 10 mm distance).
      const v = Number(await page.getAttribute("#extrude-panel", "data-preview-volume"));
      assert.ok(Math.abs(v - Math.PI * 400 * 10) < 1e-6 * v, `preview volume ${v}`);
      await page.context().close();
    });
  }

  await check("Finish Sketch with a circle half drawn waits too, then goes on (1280 px)", async () => {
    const page = await fresh(1280, false);
    await sketchOnXY(page, false, "circle");
    await clickPlane(page, [0, 0], EMPTY_TOP);
    await page.click("#finish-sketch");
    await until(page, (w) => document.getElementById("sketch-grid-error")?.textContent === w, unfinished("Finish sketch"), "the panel says the circle isn't finished");
    assert.equal(await page.evaluate(() => document.querySelector("#viewport").dataset.sketching), "true");
    // A click on the rim finishes it and the note goes; then one press finishes the sketch.
    await clickPlane(page, [10, 0], EMPTY_TOP);
    await until(page, () => /^1 circle/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the circle drawn");
    assert.ok(!(await page.isVisible("#sketch-grid-error")));
    await page.click("#finish-sketch");
    await until(page, () => document.querySelector("#viewport").dataset.sketching === "false", null, "finished at once");
    await page.context().close();
  });

  await check("a refused size in the properties goes back and says so; -60 names Flip (1280 px)", async () => {
    const page = await fresh(1280, false);
    await startWithBox(page);
    await pinProperties(page);
    await page.fill("#width", "0");
    await page.press("#width", "Enter");
    await until(page, () => document.getElementById("width").value === "40", null, "the width back");
    assert.equal(await text(page, "#error"), "The width must be more than 0 mm. It is back to 40 mm.");
    assert.equal(await text(page, "#volume"), "24,000 mm³", "the box kept");
    // A new size taken: the note goes.
    await page.fill("#width", "50");
    await until(page, () => document.querySelector("#volume")?.textContent === "30,000 mm³", null, "50 × 30 × 20");
    assert.equal(await text(page, "#error"), "");
    // An extrude of a sketch: its distance box.
    const empty = await fresh(1280, false);
    await page.context().close();
    await sketchOnXY(empty, false, "rectangle");
    await clickPlane(empty, [0, 0], EMPTY_TOP);
    await clickPlane(empty, [20, 10], EMPTY_TOP);
    await until(empty, () => /closed outline/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the rectangle");
    await empty.click("#extrude");
    await until(empty, () => (document.getElementById("extrude-panel")?.dataset.previewVolume ?? "") !== "", null, "the preview built");
    await empty.click("#extrude-ok");
    // 20 · 10 · 10 = 2,000 mm³.
    await until(empty, () => document.querySelector("#volume")?.textContent === "2,000 mm³", null, "extruded");
    await pinProperties(empty);
    await empty.fill("#height", "-60");
    await empty.press("#height", "Enter");
    await until(empty, () => document.getElementById("height").value === "10", null, "the distance back");
    assert.equal(await text(empty, "#error"), "The distance must be more than 0 mm. It is back to 10 mm. To extrude the other way, tick Flip in Edit feature.");
    if (shots) await empty.screenshot({ path: `${shots}/size-back-1280.png` });
    await empty.context().close();
  });

  await check("an outline touching itself is refused in plain words (1280 px)", async () => {
    const page = await fresh(1280, false);
    await sketchOnXY(page, false, "line");
    // (10, 0) is on the first line, (0, 0)→(20, 0): the outline touches itself there.
    for (const p of [[0, 0], [20, 0], [20, 10], [10, 0], [0, 10], [0, 0]]) await clickPlane(page, p, EMPTY_TOP);
    await until(page, () => /^5 lines/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "five lines");
    const status = await text(page, "#sketch-status");
    assert.equal(status, `5 lines, not closed: ${TOUCHING}.`);
    assert.doesNotMatch(status, /0e0|piece|loop/);
    await page.context().close();
  });

  await check("the whole design's STL says which hidden body it left out (1280 px)", async () => {
    const page = await fresh(1280, false);
    await startWithBox(page);
    await insertPreset(page, "cylinder");
    await until(page, () => document.querySelectorAll('#browser [data-eye^="body-"]').length === 2, null, "two bodies");
    await page.click('#browser [data-eye="body-2"]');
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Show Body 2", null, "Body 2 hidden");
    await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl")]);
    await until(page, () => /hidden/.test(document.getElementById("action-note")?.textContent ?? ""), null, "the note");
    // After the export's own words (the file it saved).
    assert.equal(await text(page, "#action-note"), "Exported spindlelabs-box.stl. Body 2 is hidden, so it is not in the STL: show it with its eye in the browser to include it.");
    await page.context().close();
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
