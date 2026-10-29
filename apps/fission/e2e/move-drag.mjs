// Browser check of Move's arrows and rings (step 35e2c, move-handles.ts,
// move-layer.ts): with the box picked they stand at its middle (20, 15, 10);
// the X arrow lights under the pointer; dragged 15.3 mm along X it fills the
// X box with 15 (whole millimetres), the handles follow to (35, 15, 10), and
// the box stays picked (the drag neither picks nor turns the camera);
// dragged a quarter turn round the Z ring it fills 90 (15° steps); OK
// builds it and the STL is where it was put, worked by hand. Edit feature on
// the Move shows the handles at its moved pivot, and dragging the Z arrow
// moves the box in the view before OK (35e2b drew it as built until OK).
// At 1280 px with a mouse and at 375 px with a finger; at 393 × 852 (Ben's
// iPhone) the handles stay in the view above the Properties sheet. Snap
// (35e2d): with a ⌀40 × 20 cylinder inserted beside the box, the cylinder's
// top clicked and then the box's top turns the cylinder over (180° about X)
// onto the box, centred: the boxes fill in, OK builds it, and the STL spans
// both, worked by hand; at 393 × 852 Snap puts the Properties sheet away
// while the view is tapped and brings it back with the numbers and OK,
// never past 40% of the view. Screenshots go
// to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { preview } from "vite";
import { closePanels, insertPreset, openPanel, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4232, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4232/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));

async function fresh(width, height, touch) {
  framed = HOME;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url + "#design");
  await startWithBox(page, touch);
  return sheetsClearFor(page);
}

const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const rebuilt = (page) => until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");
const opened = (page) => until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
const closed = (page) => until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
const boxValue = (page, key) => page.inputValue(`#move-${key}`);
const viewData = (page, key) => page.evaluate((k) => document.getElementById("viewport").dataset[k], key);

/** The view the page is framed in: HOME (the box framed) until a second body frames both (`withCylinder`). */
let framed = HOME;
/** Where model point `p` is on screen in the view the box opens in (HOME: the box framed). */
async function screenAt(page, p) {
  return screenPoint(await page.locator("#viewport canvas").boundingBox(), p, framed);
}
/** A click or tap on model point `p`, the sheets put away first so the view is there to press. */
async function pressAt(page, p, tap) {
  await closePanels(page, tap);
  const s = await screenAt(page, p);
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]), "CANVAS", `(${p}) is on the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}
/** The colour of the canvas at model point `p`. */
async function colourAt(page, p) {
  await page.waitForTimeout(250); // a frame or two to paint
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = await screenAt(page, p);
  return page.evaluate(
    ([fx, fy]) => {
      const src = document.querySelector("#viewport canvas");
      const c = document.createElement("canvas");
      [c.width, c.height] = [src.width, src.height];
      const ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(src.width * fx), Math.floor(src.height * fy), 1, 1).data.slice(0, 3));
    },
    [(s.x - box.x) / box.width, (s.y - box.y) / box.height],
  );
}
const differs = (a, b) => a.some((x, i) => Math.abs(x - b[i]) > 12);

/** The handles as the view says: their centre (mm) and where a press grabs each (client px). */
async function handles(page) {
  await until(page, () => !!document.getElementById("viewport").dataset.moveHandles, null, "the handles drawn");
  const [said, centre] = await Promise.all([viewData(page, "moveHandles"), viewData(page, "moveCentre")]);
  const grab = Object.fromEntries(said.split(" ").reduce((pairs, word, i, all) => (i % 2 === 0 ? [...pairs, [word, all[i + 1].split(",").map(Number)]] : pairs), []));
  return { centre: centre.split(",").map(Number), grab };
}

/**
 * A drag by mouse or finger: pressed at `from` (client px), then through
 * `path` (client px), then let go; waits until the view heard its end.
 */
async function drag(page, from, path, touch) {
  const ended = Number((await viewData(page, "moveDrags")) ?? 0) + 1;
  if (!touch) {
    await page.mouse.move(...from);
    await page.mouse.down();
    for (const p of path) await page.mouse.move(p[0], p[1]);
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type, [x, y]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touchAt("touchStart", from);
    for (const p of path) await touchAt("touchMove", p);
    await touchAt("touchEnd", path.at(-1));
  }
  await until(page, (n) => Number(document.getElementById("viewport").dataset.moveDrags ?? 0) >= n, ended, "the drag's end heard by the view");
}

/**
 * A drag of the arrow along `axis` (0 X, 1 Y, 2 Z) by `mm` along it: pressed
 * where the view says the arrow is grabbed, which is `s0` mm from the
 * centre along the arrow (the s whose point on screen is nearest the grab
 * point), then through the points `s0 + mm·k/12` on screen.
 */
async function dragArrow(page, axis, mm, touch) {
  const { centre, grab } = await handles(page);
  const from = grab[["x", "y", "z"][axis]];
  const along = async (s) => {
    const p = centre.map((c, k) => (k === axis ? c + s : c));
    const q = await screenAt(page, p);
    return [q.x, q.y];
  };
  let s0 = 0;
  let best = Infinity;
  const canvas = await page.locator("#viewport canvas").boundingBox();
  for (let s = 0; s <= 200; s += 0.01) {
    const p = centre.map((c, k) => (k === axis ? c + s : c));
    const q = screenPoint(canvas, p, framed);
    const d = Math.hypot(q.x - from[0], q.y - from[1]);
    if (d < best) [best, s0] = [d, s];
    if (d > best + 50) break;
  }
  const path = [];
  for (let k = 1; k <= 12; k++) path.push(await along(s0 + (mm * k) / 12));
  if (!touch) {
    await page.mouse.move(...from);
    await until(page, (h) => document.getElementById("viewport").dataset.moveHot === h, ["x", "y", "z"][axis], "the arrow lit under the pointer");
  }
  await drag(page, from, path, touch);
}

/** A drag round the ring about Z from where the view says it is grabbed (45° round from +X) on to `to` degrees, through points on its plane 20 mm out. */
async function dragRingZ(page, to, touch) {
  const { centre, grab } = await handles(page);
  const path = [];
  for (let k = 1; k <= 12; k++) {
    const a = ((45 + ((to - 45) * k) / 12) * Math.PI) / 180;
    const q = await screenAt(page, [centre[0] + 20 * Math.cos(a), centre[1] + 20 * Math.sin(a), centre[2]]);
    path.push([q.x, q.y]);
  }
  await drag(page, grab.turnZ, path, touch);
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

/** The box (feature-1) and a ⌀40 × 20 cylinder (feature-2) inserted with it, standing on the origin: x and y −20..20, z 0..20. */
async function withCylinder(page, tap) {
  await insertPreset(page, "cylinder", tap);
  await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 2, null, "the cylinder in");
  await rebuilt(page);
  // The view frames both: x −20..40, y −20..30, z 0..20, so the centre (10, 5, 10) and half the diagonal √(60² + 50² + 20²)/2 = √6500/2.
  const radius = Math.sqrt(6500) / 2;
  await until(page, (r) => Math.abs(Number(document.getElementById("viewport").dataset.framedRadius) - r) < 1e-9, radius, "both bodies framed");
  await page.waitForTimeout(400); // the camera's move to the new framing
  framed = { ...HOME, centre: [10, 5, 10], radius };
}
const snapStage = (page, stage) => until(page, (s) => document.getElementById("viewport").dataset.moveSnap === s, stage, `the snap at "${stage}"`);
// Points on the cylinder's top away from the box (x < 0) and on the box's top away from the cylinder (beyond its radius 20).
const CYLINDER_TOP = [-16, -6, 20];
const BOX_TOP = [30, 21, 20];

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
    const at = `${width} px${tap ? ", a finger" : ""}`;

    await check(`${at}: the X arrow dragged 15.3 mm fills 15, a quarter turn round Z fills 90, the box stays picked; OK builds it where it was put, by hand`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await press(page, "#move", tap);
        await opened(page);
        assert.equal(await viewData(page, "moveHandles"), undefined, "no handles before a body is picked");
        await pressAt(page, [20, 15, 20], tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
        if (tap) await closePanels(page, true); // the view clear to drag in
        // The box spans 0..40, 0..30, 0..20: the handles at its middle.
        assert.deepEqual((await handles(page)).centre, [20, 15, 10]);
        if (shots) await page.screenshot({ path: `${shots}/move-handles-${width}.png` });
        await dragArrow(page, 0, 15.3, tap);
        assert.equal(await boxValue(page, "x"), "15", "15.3 mm snaps to 15");
        assert.deepEqual((await handles(page)).centre, [35, 15, 10], "the handles followed");
        assert.equal(await page.evaluate(() => document.body.dataset.selection), "body:feature-1", "the drag picked nothing");
        if (shots) await page.screenshot({ path: `${shots}/move-dragged-${width}.png` });
        await dragRingZ(page, 135, tap);
        assert.equal(await boxValue(page, "turnZ"), "90", "a quarter turn");
        // Turned 90° about Z through (20, 15, 10): (x, y) → (20 − (y − 15), 15 + (x − 20)), so x 5..35 and y −5..35;
        // then 15 along X: x 20..50. z stays 0..20.
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        // OK takes the handles away (the view takes them off on its next frame).
        await until(page, () => document.getElementById("viewport").dataset.moveHandles === undefined, null, "OK takes the handles away");
        near(await stlBounds(page, tap), [[20, 50], [-5, 35], [0, 20]], "the STL after the dragged Move");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: an edited Move shows its handles at its moved pivot, and dragging the Z arrow moves the box in the view before OK`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await press(page, "#move", tap);
        await opened(page);
        await pressAt(page, [20, 15, 20], tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
        await page.fill("#move-x", "5");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        // Edit feature from Move 1's menu.
        const item = page.locator('#timeline [data-item="feature-2"]');
        if (tap) {
          if (!(await page.isVisible('#timeline [data-more="feature-2"]'))) await (await closePanels(page, true), item.tap());
          await page.tap('#timeline [data-more="feature-2"]');
        } else await item.click({ button: "right" });
        await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
        await press(page, "#row-menu-edit", tap);
        await opened(page);
        if (tap) await closePanels(page, true);
        assert.deepEqual((await handles(page)).centre, [25, 15, 10], "at the pivot moved 5 along X");
        // A point of the box's top as built, (40, 5, 20) (x 5..45): background once the box is drawn 20 mm up.
        const corner = [40, 5, 20];
        const lit = await colourAt(page, corner);
        await dragArrow(page, 2, 20, tap);
        assert.equal(await boxValue(page, "z"), "20");
        assert.ok(differs(await colourAt(page, corner), lit), "the box drawn up before OK");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[5, 45], [0, 30], [20, 40]], "after the edit");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: Snap turns the cylinder over onto the box's top, centred; OK builds it there, by hand`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await withCylinder(page, tap);
        await press(page, "#move", tap);
        await opened(page);
        await pressAt(page, CYLINDER_TOP, tap);
        await until(page, () => document.body.dataset.selection === "body:feature-2", null, "the cylinder picked");
        if (tap) await openPanel(page, "properties", true);
        await press(page, "#move-snap", tap);
        await snapStage(page, "from");
        assert.equal(await page.textContent("#move-hint"), "Snap: click or tap a face or edge to move");
        // No handles while Snap picks: a click is a pick, never a grab (the view takes them off on its next frame).
        await until(page, () => document.getElementById("viewport").dataset.moveHandles === undefined, null, "the handles gone while Snap picks");
        if (shots) await page.screenshot({ path: `${shots}/move-snap-from-${width}.png` });
        await pressAt(page, CYLINDER_TOP, tap);
        await snapStage(page, "to");
        await pressAt(page, BOX_TOP, tap);
        await snapStage(page, "");
        // Both tops face +Z, so the cylinder turns over: half a turn about X through its middle (0, 0, 10) takes its
        // top's centre (0, 0, 20) to (0, 0, 0); the box's top is centred (20, 15, 20), so the shift is (20, 15, 20).
        const boxes = await Promise.all(["x", "y", "z", "turnX", "turnY", "turnZ"].map((k) => boxValue(page, k)));
        assert.deepEqual(boxes, ["20", "15", "20", "180", "0", "0"]);
        if (shots) await page.screenshot({ path: `${shots}/move-snap-done-${width}.png` });
        if (tap) await openPanel(page, "properties", true);
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        // The box 0..40, 0..30, 0..20 and the cylinder on it, centred (20, 15): x 0..40, y −5..35, z 20..40.
        near(await stlBounds(page, tap), [[0, 40], [-5, 35], [0, 40]], "the STL after the snap");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("393 × 852 (Ben's iPhone): Snap puts the sheet away while the view is tapped, then brings it back with the numbers, never past 40% of the view", async () => {
    const page = await fresh(393, 852, true);
    try {
      await withCylinder(page, true);
      await page.tap("#move");
      await opened(page);
      await pressAt(page, CYLINDER_TOP, true);
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "the sheet up with the boxes");
      await page.waitForTimeout(300);
      const [sheet, view] = await Promise.all([page.locator("#properties").boundingBox(), page.locator("#viewport").boundingBox()]);
      const covered = Math.max(0, Math.min(sheet.y + sheet.height, view.y + view.height) - Math.max(sheet.y, view.y)) / view.height;
      assert.ok(covered <= 0.4, `the sheet covers ${(covered * 100).toFixed(0)}% of the view`);
      // Snap puts the sheet away: the whole view is there to tap, what to tap said over it.
      await page.tap("#move-snap");
      await snapStage(page, "from");
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "false", null, "the sheet away while picking");
      assert.equal(await page.isVisible("#move-hint"), true, "what to tap is said over the view");
      if (shots) await page.screenshot({ path: `${shots}/move-snap-from-393.png` });
      for (const [p, stage] of [[CYLINDER_TOP, "to"], [BOX_TOP, ""]]) {
        const q = await screenAt(page, p);
        assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [q.x, q.y]), "CANVAS", `(${p}) is on the view`);
        await page.touchscreen.tap(q.x, q.y);
        await snapStage(page, stage);
        if (shots && stage === "to") await page.screenshot({ path: `${shots}/move-snap-to-393.png` });
      }
      // Snapped: the sheet comes back with the numbers and OK, still at most 40% of the view.
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "the sheet back with the numbers");
      await page.waitForTimeout(300);
      const back = await page.locator("#properties").boundingBox();
      assert.ok((view.y + view.height - back.y) / view.height <= 0.4, "the sheet back covers at most 40% of the view");
      assert.equal(await page.isVisible("#move-ok"), true);
      assert.equal(await boxValue(page, "turnX"), "180");
      if (shots) await page.screenshot({ path: `${shots}/move-snap-done-393.png` });
    } finally {
      await page.context().close();
    }
  });

  await check("393 × 852 (Ben's iPhone): with the box picked and the Properties sheet up, every handle is in the view above it, and a finger drags one", async () => {
    const page = await fresh(393, 852, true);
    try {
      await page.tap("#move");
      await opened(page);
      await pressAt(page, [20, 15, 20], true);
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "the sheet up with the boxes");
      await page.waitForTimeout(300);
      const { grab } = await handles(page);
      const sheet = await page.locator("#properties").boundingBox();
      for (const [h, [x, y]] of Object.entries(grab)) {
        assert.ok(y < sheet.y, `the ${h} handle (y ${y.toFixed(0)}) is above the sheet (y ${sheet.y.toFixed(0)})`);
        assert.equal(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [x, y]), "CANVAS", `the ${h} handle is on the view`);
      }
      if (shots) await page.screenshot({ path: `${shots}/move-handles-393.png` });
      await dragArrow(page, 1, -12.2, true);
      assert.equal(await boxValue(page, "y"), "-12");
      if (shots) await page.screenshot({ path: `${shots}/move-dragged-393.png` });
    } finally {
      await page.context().close();
    }
  });
  await check("1280 px: a drag whose release never arrives (Alt-Tab, a dialog mid-drag) ends at the next move with no button held", async () => {
    // Backlog 2026-10-29 (weak-spot hunt D, F1c): the box kept following a hovering pointer until the next click.
    const page = await fresh(1280, 800, false);
    try {
      await press(page, "#move", false);
      await opened(page);
      await pressAt(page, [20, 15, 20], false);
      await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
      const g = (await handles(page)).grab.x;
      const ended = Number((await viewData(page, "moveDrags")) ?? 0) + 1;
      const cdp = await page.context().newCDPSession(page);
      const mouse = (type, k, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x: g[0] + k * 8, y: g[1], button: buttons ? "left" : "none", buttons, clickCount: buttons ? 1 : 0 });
      await mouse("mouseMoved", 0, 0);
      await mouse("mousePressed", 0, 1);
      for (let k = 1; k <= 4; k++) await mouse("mouseMoved", k, 1);
      const held = await boxValue(page, "x");
      assert.notEqual(held, "0", "the drag moved the box first");
      // The release is lost: the pointer moves on with no button held.
      for (let k = 5; k <= 12; k++) await mouse("mouseMoved", k, 0);
      await until(page, (n) => Number(document.getElementById("viewport").dataset.moveDrags ?? 0) >= n, ended, "the drag ended at the first move with no button");
      assert.equal(await boxValue(page, "x"), held, "a hovering pointer moved the box");
      assert.equal(await viewData(page, "moveHot"), undefined, "the handle let go");
    } finally {
      await page.context().close();
    }
  });
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
