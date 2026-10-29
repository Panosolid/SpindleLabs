// Browser check of the Move panel (step 35e2b, move-panel.ts): Modify ▾'s
// Move (and the M key) opens it; a click on the box's top picks the box
// (the body, not the face: Fusion's Move picks bodies), the pivot boxes take
// the box's middle (20, 15, 10); typing previews the move at once (a pixel
// where the box was turns to background, and back on Escape); OK records
// one undo step, "Move bodies", and the exported STL is where the Move put
// it, worked by hand; Edit feature on the Move reopens its numbers, and the
// change is one step "Edit Move 1"; an empty box counts as 0 and keeps the
// preview up; a move out past model space is refused, recording nothing. At 1280 px with a mouse
// and at 375 px with taps; at 393 × 852 (Ben's iPhone) Move with nothing
// picked leaves the view clear (a hint over it says what to do), and once a body is picked the Properties
// sheet with the panel covers at most 40% of the view (Ben's rule: one tap
// never covers most of it). Screenshots go to E2E_SHOTS when set. Run with
// `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";
import { preview } from "vite";
import { closePanels, openPanel, sheetsClearFor, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4231, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4231/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));

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

const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
/** Every rebuild asked for has landed. */
const rebuilt = (page) => until(page, () => document.getElementById("viewport")?.dataset.rebuilding === "false", null, "the rebuild");

/** Where model point `p` is on screen in the view the box opens in (HOME: the box framed). */
async function screenAt(page, p) {
  const box = await page.locator("#viewport canvas").boundingBox();
  return screenPoint(box, p, HOME);
}
/** A click or tap on model point `p`, the sheets put away first so the view is there to press. */
async function pressAt(page, p, tap) {
  await closePanels(page, tap);
  const s = await screenAt(page, p);
  const on = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]);
  assert.equal(on, "CANVAS", `(${p}) is on the canvas`);
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

/** The Move panel as shown: its title, the bodies' line (or null when hidden), the pick note shown, every box, the pivot's summary, the error (null when hidden). */
const panel = (page) =>
  page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const boxes = Object.fromEntries([...document.querySelectorAll("#move-panel input")].map((i) => [i.id.slice(5), i.value]));
    return { open: !$("move-panel").hidden, title: $("move-title").textContent, bodies: $("move-bodies").hidden ? null : $("move-bodies").textContent, pick: !$("move-pick").hidden, boxes, pivot: $("move-pivot-summary").textContent, error: $("move-error").hidden ? null : $("move-error").textContent };
  });
const opened = (page) => until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
const closed = (page) => until(page, () => document.getElementById("move-panel")?.hidden === true, null, "the Move panel closed");
const undoTitle = (page) => page.getAttribute("#undo", "title");
const items = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item));
/** Types `text` in box `key` (x, turnZ, pivotX…), as a person would: its old text selected and replaced. */
async function type(page, key, text) {
  await page.fill(`#move-${key}`, text);
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
    const at = `${width} px${tap ? ", taps" : ""}`;

    await check(`${at}: Move picks the box by its face, turns about its middle, previews at once, and OK is one undo step; the STL is where it was put, by hand`, async () => {
      const page = await fresh(width, height, tap);
      try {
        const before = await undoTitle(page);
        await press(page, "#move", tap);
        await opened(page);
        let p = await panel(page);
        assert.deepEqual([p.title, p.bodies, p.pick, p.pivot, p.error], ["Move", null, true, "Pivot: centre of the bodies", null], "nothing picked yet: it says how");
        assert.equal(await page.isVisible("#move-hint"), true, "and over the view");
        // Nothing picked: the pivot is the origin, every box 0.
        assert.deepEqual(p.boxes, { x: "0", y: "0", z: "0", turnX: "0", turnY: "0", turnZ: "0", pivotX: "0", pivotY: "0", pivotZ: "0" });
        // The middle of the box's top, (20, 15, 20): a click there picks the body, not its top face.
        await pressAt(page, [20, 15, 20], tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked as a body");
        p = await panel(page);
        assert.equal(p.bodies, "Body: Box 1");
        assert.equal(p.pick, false);
        assert.equal(await page.isVisible("#move-hint"), false, "no hint once a body is picked");
        // The pivot follows: the box spans 0..40, 0..30, 0..20, so its middle is (20, 15, 10).
        assert.deepEqual([p.boxes.pivotX, p.boxes.pivotY, p.boxes.pivotZ], ["20", "15", "10"]);
        // A second click on it takes it out again; a third puts it back. Near a corner of the top: from 35e2c the Move's
        // handles stand at the box's middle, and a press on one drags it instead of picking (e2e/move-drag.mjs).
        await pressAt(page, [6, 4, 20], tap);
        await until(page, () => document.body.dataset.selection === "", null, "the box let go");
        await pressAt(page, [6, 4, 20], tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked again");
        // The preview: 45 mm along X takes the box off its old place at once, before any OK (no undo step yet).
        const top = [5, 5, 20];
        const lit = await colourAt(page, top); // the box's top, as drawn
        await type(page, "x", "45");
        await until(page, () => true, null, "typed");
        if (shots) await page.screenshot({ path: `${shots}/move-preview-${width}.png` });
        assert.ok(differs(await colourAt(page, top), lit), "previewed: the box has left its old place");
        // Typed back to 0 it is drawn there again: the preview follows every box.
        await type(page, "x", "0");
        assert.ok(!differs(await colourAt(page, top), lit), "typed back: the box drawn where it was");
        assert.equal(await undoTitle(page), before, "nothing recorded by typing");
        // Turned 90° about Z through (20, 15, 10), then 10 along X: about the middle (x, y) → (−(y − 15), x − 20),
        // so x 20 − 15..20 + 15 = 5..35 and y 15 − 20..15 + 20 = −5..35; shifted 10: x 15..45. z stays 0..20.
        await type(page, "x", "10");
        await type(page, "turnZ", "90");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        assert.match(await undoTitle(page), /Move bodies/);
        assert.deepEqual(await items(page), ["feature-1", "feature-2"], "Move 1 in the timeline after the box");
        assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Move 1\nMove Box 1 by (10, 0, 0) mm, turned 90° about Z");
        assert.equal(await page.evaluate(() => document.body.dataset.selection), "", "the picked bodies let go once moved");
        near(await stlBounds(page, tap), [[15, 45], [-5, 35], [0, 20]], "the STL after the Move");
        // One Undo takes it all back.
        await press(page, "#undo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [0, 20]], "the STL after Undo");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: Edit feature on a Move opens its numbers, its pivot kept; the edit is one step "Edit Move 1"; refusals record nothing; Escape and Cancel change nothing`, async () => {
      const page = await fresh(width, height, tap);
      try {
        // Box 1 selected first (its Bodies row), then M: the panel opens on it.
        await openPanel(page, "browser", tap);
        await press(page, '#browser [data-node="bodies"] .tree-row', tap);
        await until(page, () => document.body.dataset.selection === "body:feature-1", null, "Box 1 selected");
        await closePanels(page, tap);
        await page.evaluate(() => document.activeElement?.blur()); // the keys go to the page, not the row
        if (tap) await press(page, "#move", tap);
        else await page.keyboard.press("m");
        await opened(page);
        assert.equal((await panel(page)).bodies, "Body: Box 1");
        await type(page, "z", "5");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [5, 25]], "moved up 5");
        // Edit feature from the timeline item's menu.
        const item = page.locator('#timeline [data-item="feature-2"]');
        if (tap) {
          if (!(await page.isVisible('#timeline [data-more="feature-2"]'))) await (await closePanels(page, true), item.tap());
          await page.tap('#timeline [data-more="feature-2"]');
        } else await item.click({ button: "right" });
        await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
        assert.equal(await page.getAttribute("#row-menu-edit", "aria-disabled"), null, "Edit feature is on");
        await press(page, "#row-menu-edit", tap);
        await opened(page);
        let p = await panel(page);
        assert.deepEqual([p.title, p.bodies, p.pick, p.boxes.z, p.boxes.pivotX, p.boxes.pivotY, p.boxes.pivotZ, p.pivot], ["Edit Move 1", "Body: Box 1", false, "5", "20", "15", "10", "Pivot (20, 15, 10) mm"], "its own numbers");
        // A box cleared counts as 0 (Ben, 2026-10-28): no error, and the preview's handles stay up at the moved pivot (20, 15, 15).
        const steps = await undoTitle(page);
        await type(page, "y", "");
        await until(page, () => document.getElementById("viewport").dataset.moveCentre === "20,15,15", null, "the handles still up with Y empty");
        assert.equal((await panel(page)).error, null);
        // Going on to another box fills the empty one with 0 (Ben, 2026-10-28).
        await page.focus("#move-z");
        assert.equal((await panel(page)).boxes.y, "0", "the emptied box shows 0 once left");
        // Out past model space (100 km = 1e8 mm): the kernel's words, nothing recorded, the panel still open.
        await type(page, "y", "0");
        await type(page, "x", "200000000");
        await press(page, "#move-ok", tap);
        await until(page, () => /1e8 mm/.test(document.getElementById("move-error").textContent) && !document.getElementById("move-error").hidden, null, "the kernel's refusal");
        assert.equal(await undoTitle(page), steps, "refused: nothing recorded");
        assert.equal((await panel(page)).open, true);
        if (shots) await page.screenshot({ path: `${shots}/move-refused-${width}.png` });
        // Escape: closed, nothing changed.
        if (!tap) {
          await page.keyboard.press("Escape");
          await closed(page);
          assert.equal(await undoTitle(page), steps);
          await item.click({ button: "right" });
          await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu again");
          await press(page, "#row-menu-edit", tap);
          await opened(page);
        } else {
          await press(page, "#move-cancel", tap);
          await closed(page);
          assert.equal(await undoTitle(page), steps);
          if (!(await page.isVisible('#timeline [data-more="feature-2"]'))) await (await closePanels(page, true), item.tap());
          await page.tap('#timeline [data-more="feature-2"]');
          await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu again");
          await press(page, "#row-menu-edit", tap);
          await opened(page);
        }
        // Up 12 instead, turned 90° about X about the kept pivot (20, 15, 10): (y, z) → (15 − (z − 10), 10 + (y − 15)),
        // y 15 − 10..15 + 10 = 5..25, z 10 − 15..10 + 15 = −5..25, then up 12: z 7..37.
        await type(page, "z", "12");
        await type(page, "turnX", "90");
        await press(page, "#move-ok", tap);
        await closed(page);
        await rebuilt(page);
        assert.match(await undoTitle(page), /Edit Move 1/);
        near(await stlBounds(page, tap), [[0, 40], [5, 25], [7, 37]], "after the edit");
        await press(page, "#undo", tap);
        await rebuilt(page);
        near(await stlBounds(page, tap), [[0, 40], [0, 30], [5, 25]], "Undo puts the Move's old numbers back");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("393 × 852 (Ben's iPhone): Move with nothing picked leaves the view clear; once the box is picked the sheet covers at most 40% of the view", async () => {
    const page = await fresh(393, 852, true);
    try {
      await page.tap("#move");
      await until(page, () => document.getElementById("move-panel")?.hidden === false, null, "the Move panel open");
      await page.waitForTimeout(300);
      assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "false", "the Properties sheet stays shut while nothing is picked");
      // What to do is said over the view instead, clear of the part.
      assert.equal(await page.isVisible("#move-hint"), true, "the hint over the view");
      assert.equal(await page.textContent("#move-hint"), "Move: click or tap the bodies to move");
      if (shots) await page.screenshot({ path: `${shots}/move-pick-393.png` });
      await pressAt(page, [20, 15, 20], true);
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "the sheet opens with the boxes once a body is picked");
      await page.waitForTimeout(300);
      assert.equal(await page.isVisible("#move-hint"), false, "the hint goes once a body is picked");
      const [sheet, view] = await Promise.all([page.locator("#properties").boundingBox(), page.locator("#viewport").boundingBox()]);
      const covered = Math.max(0, Math.min(sheet.y + sheet.height, view.y + view.height) - Math.max(sheet.y, view.y)) / view.height;
      assert.ok(covered <= 0.4, `the sheet covers ${(covered * 100).toFixed(0)}% of the view`);
      // Everything to make the Move is in reach in the sheet: the three distances, the three angles, OK and Cancel.
      for (const id of ["move-x", "move-y", "move-z", "move-turnX", "move-turnY", "move-turnZ", "move-ok", "move-cancel"]) {
        const b = await page.locator(`#${id}`).boundingBox();
        assert.ok(b && b.y >= sheet.y && b.y + b.height <= sheet.y + sheet.height + 1, `${id} is in the sheet`);
      }
      if (shots) await page.screenshot({ path: `${shots}/move-sheet-393.png` });
      await page.fill("#move-y", "-25");
      if (shots) await page.screenshot({ path: `${shots}/move-typed-393.png` });
      await page.tap("#move-ok");
      await until(page, () => document.getElementById("move-panel")?.hidden === true, null, "closed");
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "false", null, "OK puts the sheet away");
      if (shots) await page.screenshot({ path: `${shots}/move-done-393.png` });
      // The check can fail: with the panel's phone rule off (the rest of the properties under it), the sheet grows past 40%.
      await page.tap("#move");
      await page.evaluate(() => document.getElementById("move-panel").classList.remove("move-panel"));
      await pressAt(page, [20, -10, 20], true); // the moved box's top: y −25..5
      await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "the sheet open");
      await page.waitForTimeout(300);
      const [grown, view2] = await Promise.all([page.locator("#properties").boundingBox(), page.locator("#viewport").boundingBox()]);
      assert.ok(grown.height / view2.height > 0.4, `without the rule the sheet covers ${((grown.height / view2.height) * 100).toFixed(0)}%: the check can fail`);
    } finally {
      await page.context().close();
    }
  });
  // Weak-spot hunt 10-29, at 1280 px: (1) text the number box can't read ("1e") was recorded as 0; (2) Edit Move on a
  // 1e-7 mm Move with nothing changed recorded "Edit Move 1" and set X to 0 (the box shows it rounded); (3) X = 1e308
  // in the preview gave the view NaN sizes (console errors) and the box vanished.
  await check("1280 px: unreadable text is refused, an unchanged tiny Move records nothing, a huge one leaves the preview drawn", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await page.click("#move");
      await opened(page);
      await pressAt(page, [20, 15, 20], false);
      await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
      const before = await undoTitle(page);
      // (3) Huge: the box stays drawn where it was (the preview can't draw it there), and no errors (checked at the end).
      const top = [5, 5, 20];
      const lit = await colourAt(page, top);
      await type(page, "x", "1e308");
      assert.ok(!differs(await colourAt(page, top), lit), "a 1e308 mm Move leaves the box drawn unmoved");
      // (1) "1e" in X with Y 5: OK refuses it, naming the box, and records nothing; leaving the box doesn't make it 0.
      await type(page, "y", "5");
      await page.focus("#move-x");
      await page.keyboard.press("Control+a");
      await page.keyboard.type("1e");
      assert.equal(await page.$eval("#move-x", (i) => i.validity.badInput), true, "the box holds text it can't read");
      await page.focus("#move-z");
      assert.equal((await panel(page)).boxes.x, "", "left as typed, not filled with 0");
      await page.click("#move-ok");
      await until(page, () => !document.getElementById("move-error").hidden, null, "Move refuses");
      assert.match((await panel(page)).error, /X distance/);
      assert.equal((await panel(page)).open, true);
      assert.equal(await undoTitle(page), before, "nothing recorded");
      // (2) 1e-7 mm along X: the box shows 0 once reopened, and OK with nothing changed records nothing.
      await type(page, "x", "0.0000001");
      await type(page, "y", "0");
      await page.click("#move-ok");
      await closed(page);
      await rebuilt(page);
      assert.match(await undoTitle(page), /Move bodies/);
      const moved = await undoTitle(page);
      await page.locator('#timeline [data-item="feature-2"]').click({ button: "right" });
      await until(page, () => document.getElementById("row-menu").open, null, "Move 1's menu");
      await page.click("#row-menu-edit");
      await opened(page);
      assert.equal((await panel(page)).boxes.x, "0", "1e-7 shows as 0 (to a nanometre)");
      await page.click("#move-ok");
      await closed(page);
      await rebuilt(page);
      assert.equal(await undoTitle(page), moved, "no Edit Move step for an unchanged Move");
      assert.equal(await page.getAttribute('#timeline [data-item="feature-2"]', "title"), "2. Move 1\nMove Box 1 by (1e-7, 0, 0) mm", "its 1e-7 kept");
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
