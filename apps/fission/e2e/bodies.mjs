// Browser check that Design draws every body (step 24d3b): the default
// 40 × 30 × 20 box, then a 10 × 10 square sketched beside it at x 50 to 60
// and extruded by 10 (a second body, 24d1). Both are drawn (pixel probes on
// each top face), the view frames both, the browser's Bodies group lists
// Body 1 and Body 2, a click on either top face selects that body's face by
// its stable name, and Body 2's row tints only its own faces. The same at
// 375 px with taps. File ▾ > New (start-fresh.ts) with both bodies there:
// it asks, Cancel and Escape change nothing, confirmed it leaves the fresh
// box alone, and one Undo brings everything back. Screenshots go to
// E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { withPropertiesFolded } from "./properties.mjs";
import { clickPlane, screenPoint, TOP } from "./sketch-screen.mjs";
import { preview } from "vite";
import { chooseFile, closePanels, fileItem, gridSnapOn, openPanel, sheetsClearFor, startWithBox, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4205, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4205/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(async () => assert.fail(`${what}: timed out`));

async function fresh(width, touch, { box = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, acceptDownloads: true });
  const page = await context.newPage();
  // A reload the test marks ("kept") keeps the stored project.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("kept")) indexedDB.deleteDatabase("fission");
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  if (box) await startWithBox(page); // a new project starts empty (U0c): the 40 × 30 × 20 box, inserted
  else await page.waitForSelector("#start-hint", { state: "visible" });
  return sheetsClearFor(page); // phone: sheets (U5) open for what is inside them and close before the view's, Undo's or the timeline's buttons are pressed
}

const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

/** Clicks (or taps) a model point as `view` sees it. */
async function at(page, p, view, tap) {
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = screenPoint(box, p, view);
  await closePanels(page, tap); // phone: an open sheet covers part of the view (U5b)
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`(${p}) is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

/** The colour of the canvas at a model point as `view` sees it. */
async function colourAt(page, p, view) {
  await page.waitForTimeout(200); // a frame or two to paint
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = screenPoint(box, p, view);
  return page.evaluate(
    ([fx, fy]) => {
      const src = document.querySelector("#viewport canvas");
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(src.width * fx), Math.floor(src.height * fy), 1, 1).data.slice(0, 3));
    },
    [(s.x - box.x) / box.width, (s.y - box.y) / box.height],
  );
}

// The canvas background and the body's grey-blue differ in every channel;
// the body colour is BASE_COLOUR (0x9a, 0xa7, 0xb8) lit, so "a body is
// here" is: not the background colour sampled in an empty corner.
const differs = (a, b) => a.some((x, i) => Math.abs(x - b[i]) > 12);
/** How blue a pixel is: the selection's accent blue (74, 168, 255) is 181 above its red, the body's grey-blue 30. */
const blue = ([r, , b]) => b - r;

/** What the properties panel's Feature and Body sections describe. */
const panelBody = (page) =>
  page.evaluate(() => ({
    heading: document.querySelector("#body-heading")?.textContent,
    volume: document.querySelector("#volume")?.textContent,
    intent: document.querySelector("#intent")?.textContent,
  }));
// The default box, 40 · 30 · 20 = 24,000 mm³.
const BODY1 = { heading: "Body 1", volume: "24,000 mm³", intent: "Box: 40 × 30 × 20 mm" };

const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");
const bodyRows = (page) => page.$$eval('[data-node="bodies"] .tree-row', (rows) => rows.map((r) => `${r.dataset.node} ${r.textContent.trim()}`));

/** Sketches a 10 × 10 square (two opposite corners on the grid, by the rectangle tool) and extrudes it: a second body. */
async function addSquare(page, { square, distance, volume }, tap) {
  // A 10 × 10 square by the rectangle tool: two opposite corners on the grid.
  await press(page, "#create-sketch", tap);
  await openPanel(page, "properties", tap); // phone: the plane choice is in the Properties sheet, closed until its toggle (U5)
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  // While a sketch is edited File ▾'s New is off, saying why, as the toolbar's Start fresh was hidden then (U0f2a).
  assert.deepEqual(await fileItem(page, "start-fresh"), [true, "New: finish or cancel the sketch first."], "New off while sketching");
  await gridSnapOn(page);
  await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
  await press(page, "#sketch-tool-rectangle", tap);
  // The sketch's panel floats over the square's corners on a wide screen (U0b).
  await withPropertiesFolded(page, async () => {
    for (const p of [square[0], square[2]]) await clickPlane(page, p, TOP, tap);
  });
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "the square closed");
  await press(page, "#sketch-extrude", tap);
  await page.fill("#extrude-distance", String(distance));
  await press(page, "#extrude-ok", tap);
  // The panel shows the part, the last body (LAYOUTS).
  await until(page, (v) => document.querySelector("#volume")?.textContent === v, volume, `the second body, ${volume}`);
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
  // At phone width Properties is a sheet over the view's lower part (U5): a person closes it to see and tap the part.
  await closePanels(page, tap);
}

/** Opens (`open`) or closes the browser: a drawer at phone width, the floating panel's fold on a wide screen. */
async function foldBrowser(page, open, tap) {
  if (await page.isVisible("#browser-toggle")) {
    if ((await page.getAttribute("#browser-toggle", "aria-expanded")) !== String(open)) await press(page, "#browser-toggle", tap);
  } else if ((await page.$eval("#browser .browser-fold", (d) => d.open)) !== open) await press(page, "#browser .browser-fold > summary", tap);
}

/** Each Body row's eye as [its row, its words, pressed, its icon], read in the page. */
const eyes = (page) => page.$$eval('#browser [data-eye^="body-"]', (es) => es.map((e) => [e.dataset.eye, e.getAttribute("aria-label"), e.getAttribute("aria-pressed"), e.querySelector("svg")?.dataset.icon]));

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

// The square sits where the sketch's top view shows it: beside the box at
// 1280 px; behind it at 375 px, where the view is narrow and tall (and the
// bottom of the screen is the navigation bar), extruded taller than the box
// so its top shows over it.
// Each layout's framing worked out by hand: the bounds' centre, and half
// their diagonal for the radius.
const LAYOUTS = [
  // [0, 60] × [0, 30] × [0, 20]: centre (30, 15, 10), radius √(60² + 30² + 20²)/2 = 35.
  // Body 2: 10 · 10 · 10 = 1,000 mm³.
  { width: 1280, tap: false, square: [[50, 0], [60, 0], [60, 10], [50, 10]], distance: 10, volume: "1,000 mm³", centre: [30, 15, 10], radius: 35, top2: [55, 5, 10] },
  // [0, 40] × [0, 50] × [0, 30]: centre (20, 25, 15), radius √(40² + 50² + 30²)/2 = √5000/2.
  // Body 2: 10 · 10 · 30 = 3,000 mm³; its top's middle (15, 45, 30) seen
  // along (0.6, −0.8, 0.55) passes y = 30 at z = 30 + 15/0.8 · 0.55 ≈ 40,
  // above the box, so it is in sight.
  { width: 375, tap: true, square: [[10, 40], [20, 40], [20, 50], [10, 50]], distance: 30, volume: "3,000 mm³", centre: [20, 25, 15], radius: Math.sqrt(5000) / 2, top2: [15, 45, 30] },
];

for (const { width, tap, square, distance, volume, centre, radius: want, top2 } of LAYOUTS) {
  await check(`two bodies drawn, framed, listed and picked (${width} px${tap ? ", taps" : ""})`, async () => {
    const page = await fresh(width, tap);
    await addSquare(page, { square, distance, volume }, tap);

    // The panels may have scrolled the page at phone width: back to the top.
    await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
    // Framed on both (LAYOUTS).
    const radius = Number(await page.evaluate(() => document.querySelector("#viewport").dataset.framedRadius));
    assert.ok(Math.abs(radius - want) < 1e-6, `framed radius ${radius}, want ${want}`);
    const view = { toward: [0.6, -0.8, 0.55], up: [0, 0, 1], centre, radius: want };
    if (shots) await page.screenshot({ path: `${shots}/bodies-${width}.png` });

    // Both drawn: each top face's middle is not the background, sampled at
    // 60 mm under the middle of the floor, where no body is.
    const empty = await colourAt(page, [centre[0], centre[1], -60], view);
    const box1 = await colourAt(page, [20, 15, 20], view);
    const box2 = await colourAt(page, top2, view);
    assert.ok(differs(box1, empty), `body 1's top ${box1} looks like the background ${empty}`);
    assert.ok(differs(box2, empty), `body 2's top ${box2} looks like the background ${empty}`);

    // A click on each top face selects that body's top by name: the box is
    // feature-1; the extrude is the newest feature, after the sketch.
    await at(page, [20, 15, 20], view, tap);
    await until(page, () => document.body.dataset.selection === "face:feature-1/top", null, `body 1's top (got ${await selection(page)})`);
    // The panel describes the picked face's body (Ben's report: it always showed the last body).
    assert.deepEqual(await panelBody(page), BODY1);
    await at(page, top2, view, tap);
    const picked = await selection(page);
    assert.match(picked, /^face:feature-\d+\/end$/, "body 2's top is its extrude's end cap");
    assert.notEqual(picked.split("/")[0], "face:feature-1");
    const body2 = { heading: "Body 2", volume, intent: `Extrude Sketch 1 by ${distance} mm` };
    assert.deepEqual(await panelBody(page), body2);

    // Listed in build order, in the browser (a drawer at phone width,
    // opened for the rows and closed again before looking at the canvas).
    const fold = (open) => foldBrowser(page, open, tap);
    await fold(true);
    await page.evaluate(() => document.querySelector('#browser [data-node="bodies"]')?.closest("details")?.setAttribute("open", ""));
    assert.deepEqual(await bodyRows(page), ["body-1 Body 1", "body-2 Body 2"]);

    // Body 2's row tints its faces, not body 1's.
    await press(page, '#browser [data-node="body-2"]', tap);
    await until(page, () => document.body.dataset.selection?.startsWith("body:"), null, "Body 2 selected");
    await fold(false);
    assert.notEqual(await selection(page), "body:feature-1");
    const lit1 = await colourAt(page, [20, 15, 20], view);
    const lit2 = await colourAt(page, top2, view);
    assert.ok(blue(lit2) > blue(box2) + 20, `body 2 tinted: ${lit2} vs ${box2}`);
    assert.ok(Math.abs(blue(lit1) - blue(box1)) < 6, `body 1 untouched: ${lit1} vs ${box1}`);
    assert.deepEqual(await panelBody(page), body2);
    if (shots) await page.screenshot({ path: `${shots}/bodies-${width}-selected.png` });

    // Body 1's row: its faces tinted, not body 2's, and the panel shows the box, not the last body.
    await fold(true);
    await press(page, '#browser [data-node="body-1"]', tap);
    await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Body 1 selected");
    assert.deepEqual(await panelBody(page), BODY1);
    await fold(false);
    const box1lit = await colourAt(page, [20, 15, 20], view);
    const box2now = await colourAt(page, top2, view);
    assert.ok(blue(box1lit) > blue(box1) + 20, `body 1 tinted: ${box1lit} vs ${box1}`);
    assert.ok(Math.abs(blue(box2now) - blue(box2)) < 6, `body 2 untouched: ${box2now} vs ${box2}`);
    if (shots) await page.screenshot({ path: `${shots}/bodies-${width}-body1.png` });
    // Escape clears the selection: back to the last body, the part the parameters edit.
    await page.keyboard.press("Escape");
    await until(page, () => !document.body.dataset.selection, null, "nothing selected");
    assert.deepEqual(await panelBody(page), body2);
    if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
    await page.context().close();
  });

  await check(`Start fresh clears both bodies and the sketch after asking, as one undo step (${width} px${tap ? ", taps" : ""})`, async () => {
    const page = await fresh(width, tap, { box: false });
    const state = () =>
      page.evaluate(() => ({
        volume: document.querySelector("#volume")?.textContent,
        sketches: document.querySelectorAll('#browser [data-node^="sketches/"]').length,
        timeline: document.querySelectorAll("#timeline [data-item]").length,
        open: document.getElementById("start-fresh-dialog").open,
        undo: document.getElementById("undo").title,
      }));
    const ALREADY = "New: nothing to clear, the design is already empty.";
    const ON = "New: clear the whole design and start again from an empty one. It asks first, and Undo brings it back.";
    // A new design is already empty (U0c): File ▾'s New is off and says why.
    assert.deepEqual(await fileItem(page, "start-fresh"), [true, ALREADY]);
    await startWithBox(page, tap);
    await addSquare(page, { square, distance, volume }, tap);
    assert.deepEqual(await bodyRows(page), ["body-1 Body 1", "body-2 Body 2"]);
    const before = await state();
    assert.equal(before.sketches, 1);
    assert.deepEqual(await fileItem(page, "start-fresh"), [false, ON]);

    // Asks first, naming what goes: the box and Extrude 1 are features, Sketch 1 a sketch.
    const ask = async () => {
      await chooseFile(page, "start-fresh", tap);
      await until(page, () => document.getElementById("start-fresh-dialog").open, null, "the dialog");
    };
    await ask();
    assert.equal(
      await page.textContent("#start-fresh-words"),
      "This clears everything in the design (1 sketch and 2 features) and starts again from an empty design, as a new project opens. Undo brings it all back.",
    );
    assert.equal(await page.evaluate(() => document.activeElement?.id), "start-fresh-cancel", "Cancel has the focus");
    const box = await page.locator("#start-fresh-dialog").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `the dialog fits the screen: ${box.x} to ${box.x + box.width} of ${width}`);
    if (shots) await page.screenshot({ path: `${shots}/start-fresh-${width}-ask.png` });
    // Cancel, then Escape: each closes it and nothing changes (Escape doesn't clear the selection behind it either).
    await press(page, "#start-fresh-cancel", tap);
    assert.deepEqual(await state(), before);
    await ask();
    await page.keyboard.press("r"); // the rectangle tool's key, never reaching the app behind the dialog
    await page.keyboard.press("Escape");
    await until(page, () => !document.getElementById("start-fresh-dialog").open, null, "closed by Escape");
    assert.deepEqual(await state(), before);
    assert.deepEqual(await bodyRows(page), ["body-1 Body 1", "body-2 Body 2"]);

    // Confirmed: an empty design, as a new project opens (U0c): no body, no sketch, no timeline item, the hint back; the button off again.
    await ask();
    await press(page, "#start-fresh-confirm", tap);
    await until(page, () => document.getElementById("start-hint")?.hidden === false, null, "the empty design's hint");
    const after = await state();
    assert.deepEqual(after, { volume: "—", sketches: 0, timeline: 0, open: false, undo: "Undo Start fresh (Ctrl+Z)" });
    assert.deepEqual(await fileItem(page, "start-fresh"), [true, ALREADY], "New off again");
    assert.deepEqual(await bodyRows(page), []);
    // Nothing drawn: the view shows no part.
    await until(page, () => document.querySelector("#viewport").dataset.shape === "none", null, "no part drawn");
    if (shots) await page.screenshot({ path: `${shots}/start-fresh-${width}-after.png` });

    // One undo step: a single Undo brings both bodies and the sketch back; Redo clears them again.
    await closePanels(page, tap); // a Properties sheet would cover Undo and Redo docked in the view
    await press(page, "#undo", tap);
    await until(page, (v) => document.querySelector("#volume")?.textContent === v, volume, "undone");
    assert.deepEqual({ ...(await state()), undo: "" }, { ...before, undo: "" });
    assert.deepEqual(await bodyRows(page), ["body-1 Body 1", "body-2 Body 2"]);
    await closePanels(page, tap);
    await press(page, "#redo", tap);
    await until(page, () => document.getElementById("start-hint")?.hidden === false, null, "redone");
    assert.deepEqual(await bodyRows(page), []);
    if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
    await page.context().close();
  });

  // U0f3: the eye before each Body row (Fusion's) hides its body and shows it again.
  await check(`the eye hides Body 2 and shows it again: pixels probed, one undo step each, kept on reload, left out of the STL (${width} px${tap ? ", taps" : ""})`, async () => {
    const page = await fresh(width, tap);
    await addSquare(page, { square, distance, volume }, tap);
    await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
    const view = { toward: [0.6, -0.8, 0.55], up: [0, 0, 1], centre, radius: want };
    const framed = () => page.evaluate(() => document.querySelector("#viewport").dataset.framedRadius);
    const radius = await framed();
    // A body's lit grey-blue is far brighter than the dark background and the floor's grid (smoke.mjs's rule).
    const isBody = ([r, g, b]) => r + g + b > 3 * 80;
    const box2 = await colourAt(page, top2, view);
    assert.ok(isBody(box2), `body 2 drawn first: ${box2}`);
    await foldBrowser(page, true, tap);
    assert.deepEqual(await eyes(page), [["body-1", "Hide Body 1", "true", "eye"], ["body-2", "Hide Body 2", "true", "eye"]]);
    // The eye is the row's first thing on its line, before its icon and words; a finger's 44 px on a phone.
    const eye = await page.locator('#browser [data-eye="body-2"]').boundingBox();
    const row = await page.locator('#browser .tree-row[data-node="body-2"]').boundingBox();
    assert.ok(eye.x + eye.width <= row.x + 0.5 && Math.abs(eye.y + eye.height / 2 - (row.y + row.height / 2)) < 2, `the eye ${JSON.stringify(eye)} left of its row ${JSON.stringify(row)}, on its line`);
    if (tap) assert.ok(eye.width >= 44 && eye.height >= 44, `the eye ${eye.width} × ${eye.height} px, under a finger's 44`);
    if (shots) await page.screenshot({ path: `${shots}/eye-${width}-shown.png` });

    // Hidden: the eye crossed out, the row dimmed and selecting nothing, the body gone from the view, the camera kept.
    await press(page, '#browser [data-eye="body-2"]', tap);
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Show Body 2", null, "Body 2 hidden");
    assert.deepEqual(await eyes(page), [["body-1", "Hide Body 1", "true", "eye"], ["body-2", "Show Body 2", "false", "eye-off"]]);
    assert.equal(await page.getAttribute("#undo", "title"), "Undo Hide Body 2 (Ctrl+Z)");
    assert.equal(await page.$eval('#browser .tree-row[data-node="body-2"]', (r) => r.tagName), "SPAN", "a hidden body's row is no button");
    const dim = await page.$eval('#browser .tree-row[data-node="body-2"]', (r) => Number(getComputedStyle(r).opacity));
    assert.ok(dim < 0.7, `the hidden row dimmed: opacity ${dim}`);
    if (shots) await page.screenshot({ path: `${shots}/eye-${width}-hidden-browser.png` });
    await foldBrowser(page, false, tap);
    assert.equal(await framed(), radius, "hiding keeps the camera where it is");
    const gone = await colourAt(page, top2, view);
    assert.ok(!isBody(gone) && differs(gone, box2), `body 2's top hidden: ${gone}, drawn it was ${box2}`);
    assert.ok(isBody(await colourAt(page, [20, 15, 20], view)), "body 1 still drawn");
    if (shots) await page.screenshot({ path: `${shots}/eye-${width}-hidden.png` });
    // A click where it was picks nothing of it.
    await at(page, top2, view, tap);
    await page.waitForTimeout(200);
    assert.doesNotMatch(await selection(page), /\/end$/, "nothing of the hidden body picked");
    await page.keyboard.press("Escape");
    // The whole design's STL holds Body 1 alone: 80 + 4 + 12 · 50 = 684 bytes (the box's 12 triangles).
    const [stl] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
    assert.equal(readFileSync(await stl.path()).length, 684, "the STL leaves the hidden body out");

    // Undo shows it again, Redo hides it again: one step each.
    await press(page, "#undo", tap);
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Hide Body 2", null, "undone: shown");
    assert.ok(isBody(await colourAt(page, top2, view)), "undone: body 2 drawn again");
    await press(page, "#redo", tap);
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Show Body 2", null, "redone: hidden");

    // Saved with the project: still hidden after a reload.
    await until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "saved");
    await page.evaluate(() => sessionStorage.setItem("kept", "1"));
    await page.reload();
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Show Body 2", null, "hidden after a reload");
    await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
    // Reloaded, the camera frames what is drawn: Body 1 alone, since the square's sketch is hidden once extruded (Ben, 2026-10-29)
    // and no longer framed either. Body 1 is [0, 40] × [0, 30] × [0, 20]: centre (20, 15, 10), radius √(40² + 30² + 20²)/2 = √2900/2.
    const body1 = { ...view, centre: [20, 15, 10], radius: Math.sqrt(2900) / 2 };
    await until(page, () => document.querySelector("#viewport").dataset.framedRadius !== undefined, null, "framed after a reload");
    const reloaded = Number(await framed());
    assert.ok(Math.abs(reloaded - body1.radius) < 1e-3, `reloaded, Body 1 alone framed: radius ${reloaded}, worked out ${body1.radius}`);
    assert.ok(isBody(await colourAt(page, [20, 15, 20], body1)), "body 1 drawn after a reload");
    assert.ok(!isBody(await colourAt(page, top2, body1)), "still not drawn after a reload");

    // Shown again by its eye: drawn, and a 12 + 12 = 24-triangle STL, 80 + 4 + 24 · 50 = 1,284 bytes.
    await foldBrowser(page, true, tap);
    await press(page, '#browser [data-eye="body-2"]', tap);
    await until(page, () => document.querySelector('#browser [data-eye="body-2"]')?.getAttribute("aria-label") === "Hide Body 2", null, "shown again");
    assert.equal(await page.getAttribute("#undo", "title"), "Undo Show Body 2 (Ctrl+Z)");
    await foldBrowser(page, false, tap);
    assert.ok(isBody(await colourAt(page, top2, view)), "drawn again");
    const [both] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
    assert.equal(readFileSync(await both.path()).length, 1284, "both bodies in the STL");
    if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
    await page.context().close();
  });

  // An eye on everything (Ben, 2026-10-29, Fusion's): the extruded square's sketch hidden at once and shown again by its eye
  // where it was drawn, the Bodies folder's eye hiding both bodies, the XY plane shown and the Z axis hidden.
  await check(`an eye on every row: the extruded sketch hidden, then shown; the Bodies folder, the XY plane and the Z axis (${width} px${tap ? ", taps" : ""})`, async () => {
    const page = await fresh(width, tap);
    await addSquare(page, { square, distance, volume }, tap);
    await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
    const view = { toward: [0.6, -0.8, 0.55], up: [0, 0, 1], centre, radius: want };
    const isBody = ([r, g, b]) => r + g + b > 3 * 80;
    const data = (key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k], key);
    // Extruded: the square's four lines no longer drawn, Sketch 1's eye shut.
    assert.equal(await data("sketchLines"), "0", "the extruded sketch is hidden");
    await foldBrowser(page, true, tap);
    const eyeOf = (id) => page.$eval(`#browser [data-eye="${id}"]`, (e) => [e.getAttribute("aria-label"), e.getAttribute("aria-pressed")]);
    // The sketch's row is in the Sketches folder, folded by nobody at first.
    assert.deepEqual(await eyeOf("sketches/sketch-2"), ["Show Sketch 1", "false"]);
    if (shots) await page.screenshot({ path: `${shots}/eyes-${width}-sketch-hidden.png` });
    await press(page, '#browser [data-eye="sketches/sketch-2"]', tap);
    await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "4", null, "the sketch's four lines drawn again");
    assert.equal(await page.getAttribute("#undo", "title"), "Undo Show Sketch 1 (Ctrl+Z)");
    // The Bodies folder's eye, in its title: both bodies gone, the folder left as it was (open), each body's own eye open.
    const openBefore = await page.$eval('#browser details[data-node="bodies"]', (d) => d.open);
    await press(page, '#browser [data-eye="bodies"]', tap);
    await until(page, () => document.querySelector('#browser [data-eye="bodies"]')?.getAttribute("aria-pressed") === "false", null, "the Bodies folder shut");
    assert.equal(await page.$eval('#browser details[data-node="bodies"]', (d) => d.open), openBefore, "the eye doesn't fold the folder");
    assert.deepEqual(await eyeOf("body-2"), ["Hide Body 2", "true"]);
    if (shots) await page.screenshot({ path: `${shots}/eyes-${width}-bodies-folder.png` });
    await foldBrowser(page, false, tap);
    for (const p of [top2, [20, 15, 20]]) assert.ok(!isBody(await colourAt(page, p, view)), `nothing drawn at ${p} with the Bodies folder shut`);
    await foldBrowser(page, true, tap);
    await press(page, '#browser [data-eye="bodies"]', tap);
    await until(page, () => document.querySelector('#browser [data-eye="bodies"]')?.getAttribute("aria-pressed") === "true", null, "the Bodies folder open");
    // The origin, folded at first: opened, its XY plane shown and its Z axis hidden.
    assert.equal(await data("origin"), "x y z");
    if (!(await page.$eval('#browser details[data-node="origin"]', (d) => d.open))) await press(page, '#browser details[data-node="origin"] > summary', tap);
    await press(page, '#browser [data-eye="origin-xy"]', tap);
    await until(page, () => document.querySelector("#viewport").dataset.origin === "x y z origin-xy", null, "the XY plane shown");
    await press(page, '#browser [data-eye="origin-z"]', tap);
    await until(page, () => document.querySelector("#viewport").dataset.origin === "x y origin-xy", null, "the Z axis hidden");
    if (shots) await page.screenshot({ path: `${shots}/eyes-${width}-origin-browser.png` });
    await foldBrowser(page, false, tap);
    assert.ok(isBody(await colourAt(page, top2, view)), "body 2 drawn again");
    if (shots) await page.screenshot({ path: `${shots}/eyes-${width}-origin.png` });
    if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
    await page.context().close();
  });
}

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
