// Browser check of Extrude like Fusion (UX1b): a file with a small box and
// two closed sketches on XY (a 40 × 30 rectangle, a circle of radius 8).
// Extrude from the toolbar offers both outlines in the view; the pointer
// over one lights it (and over neither lights none); a click on the
// rectangle chooses it, its fill drawn brighter than the circle's; the
// extrude is previewed see-through (the panel's volume is the kernel's);
// dragging the arrow up sets a whole-mm distance, the box following, and
// dragging it below the plane makes it negative; Enter makes the body the
// preview showed, one undo step; Escape after a drag leaves nothing. The
// same at 375 px with taps and a finger drag. Screen points come from the
// main view's camera (`?test-hooks`), and every one is checked against the
// viewport's own hover first. Screenshots go to E2E_SHOTS when set. Run
// with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4196/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

/** The box (feature-1, 10 × 10 × 10 from the origin): the middle of its top face, and its six faces' names as Extrude offers them. */
const BOX = { top: [5, 5, 10] };
const BOX_FACES = ["bottom", "top", "front", "back", "left", "right"].map((f) => `face:feature-1/${f}`).join(" ");
const RECT = { id: "sketch-2", corners: [[-60, 0], [-20, 0], [-20, 30], [-60, 30]], centre: [-40, 15, 0], area: 1200 };
const CIRCLE = { id: "sketch-11", centre: [25, -25, 0], radius: 8 };
const item = (id, label) => ({ id, intent: { type: "sketch", parameters: { plane: "XY" }, summary: `${label} on the XY plane` }, provenance: { self: { workspace: "design", id, label }, from: [] }, dependsOn: [], suppressed: false });
const project = {
  formatVersion: 2,
  name: "Extrude drag",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 3,
      nextId: 20,
      profiles: [],
      sketches: [
        {
          id: RECT.id,
          points: RECT.corners.map(([x, y], i) => ({ id: `point-${3 + i}`, x, y })),
          curves: RECT.corners.map((_, i) => ({ id: `line-${7 + i}`, kind: "line", start: `point-${3 + i}`, end: `point-${3 + ((i + 1) % 4)}` })),
          constraints: [],
        },
        { id: CIRCLE.id, points: [{ id: "point-12", x: CIRCLE.centre[0], y: CIRCLE.centre[1] }], curves: [{ id: "circle-13", kind: "circle", centre: "point-12", radius: CIRCLE.radius }], constraints: [] },
      ],
      timeline: {
        features: [
          { id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Feature 1 (box)" }, from: [] }, dependsOn: [], suppressed: false },
          item(RECT.id, "Sketch 1"),
          item(CIRCLE.id, "Sketch 2"),
        ],
      },
    },
  },
};

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForSelector("#start-hint", { state: "visible", timeout: 15000 });
  await page.setInputFiles("#open-file", { name: "drag.fission.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await untilBodies(page, 1, "the box built");
  // The kernel holding the box is not the box drawn: wait for the view to frame it and no rebuild to be running,
  // so a pixel read now is the box's and Extrude finds its faces (slow-kernel flake, E2E_KERNEL_DELAY seed 1).
  await page.waitForFunction(() => {
    const v = document.querySelector("#viewport");
    return Number(v.dataset.fits ?? 0) >= 1 && v.dataset.rebuilding !== "true";
  }, null, { timeout: 15000 }).catch(() => assert.fail("the box drawn: timed out"));
  return page;
}

const until = (page, fn, arg, what, state) =>
  page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out${state ? `; ${await state(page).catch((e) => `(state unreadable: ${e.message})`)}` : ""}`));
/** What the panel and the view show, for a timed-out wait's message: so a flake on CI says what it saw. */
const panelState = (page) =>
  page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const panel = q("#extrude-panel");
    return JSON.stringify({
      volume: q("#volume")?.textContent,
      panel: panel?.hidden ? "hidden" : "shown",
      distance: q("#extrude-distance")?.value,
      ok: q("#extrude-ok") ? (q("#extrude-ok").disabled ? "off" : "on") : "gone",
      status: q("#extrude-status")?.textContent,
      error: q("#extrude-error")?.textContent,
      undo: q("#undo")?.title,
      bodies: await window.fissionTest?.bodyCount(),
      rebuilding: q("#viewport")?.dataset.rebuilding,
      offered: q("#viewport")?.dataset.extrudeProfiles,
    });
  });
const view = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const undoTitle = (page) => page.evaluate(() => document.getElementById("undo").title);

/** Where a model point is on screen in the main view: the camera as the viewport keeps it, 45° high, the canvas's aspect. */
async function screen(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => a.map((x) => x / Math.hypot(...a));
  const fwd = unit(sub(cam.target, cam.position));
  const right = unit(cross(fwd, cam.up));
  const up = cross(right, fwd);
  const v = sub(p, cam.position);
  const t = Math.tan(Math.PI / 8);
  const x = dot(v, right) / (dot(v, fwd) * t * (box.width / box.height));
  const y = dot(v, up) / (dot(v, fwd) * t);
  return { x: box.x + ((x + 1) / 2) * box.width, y: box.y + ((1 - y) / 2) * box.height };
}

/** The pointer moved to a model point; waits until the viewport lights `want` there ("" for nothing). */
async function hoverAt(page, p, want) {
  const s = await screen(page, p);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, s), "CANVAS", `(${p}) is on the view, not under a panel`);
  await page.mouse.move(s.x, s.y);
  await until(page, (w) => (document.querySelector("#viewport").dataset.extrudeHover ?? "") === w, want, `the pointer at (${p}) lights "${want}"`);
  return s;
}

/** The arrow's foot and tip on screen, as the main view says. */
async function arrow(page) {
  const said = await view(page, "arrow");
  assert.ok(said, "the arrow is drawn");
  const [foot, tip] = said.split(" ").map((xy) => xy.split(",").map(Number));
  return { foot, tip };
}

/** The canvas's colour at a point on screen (client pixels), a moment after it settles. */
async function pixel(page, { x, y }) {
  await page.waitForTimeout(300);
  return page.evaluate(({ x, y }) => {
    const src = document.querySelector("#viewport canvas");
    const r = src.getBoundingClientRect();
    const dpr = src.width / r.width;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    return Array.from(ctx.getImageData(Math.round((x - r.x) * dpr), Math.round((y - r.y) * dpr), 1, 1).data.slice(0, 3));
  }, { x, y });
}

/** A drag of the arrow from 0.6 of the way up it, `along` px further along its line on screen (negative back down), by mouse or by finger. */
async function dragArrow(page, along, touch) {
  const ended = Number(await view(page, "arrowDrags")) + 1;
  await sendDrag(page, along, touch);
  // The browser may still be handing the page the moves sent (a finger's moves come once a frame):
  // only once the drag's end is heard is the distance the drag's last one (merge-queue flake, 2026-10-26).
  await until(page, (n) => Number(document.querySelector("#viewport").dataset.arrowDrags ?? 0) >= n, ended, "the drag's end heard by the view");
}

async function sendDrag(page, along, touch) {
  const { foot, tip } = await arrow(page);
  const len = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
  const u = [(tip[0] - foot[0]) / len, (tip[1] - foot[1]) / len];
  const from = [foot[0] + 0.6 * (tip[0] - foot[0]), foot[1] + 0.6 * (tip[1] - foot[1])];
  const steps = 12;
  const at = (k) => [from[0] + (along * k * u[0]) / steps, from[1] + (along * k * u[1]) / steps];
  if (!touch) {
    await page.mouse.move(...from);
    await until(page, () => document.querySelector("#viewport").dataset.arrowHot === "true", null, "the arrow lit under the pointer");
    await page.mouse.down();
    for (let k = 1; k <= steps; k++) await page.mouse.move(...at(k));
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touchAt = (type, [x, y]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touchAt("touchStart", from);
  for (let k = 1; k <= steps; k++) await touchAt("touchMove", at(k));
  await touchAt("touchEnd", at(steps));
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
  for (const { width, touch } of [{ width: 1280, touch: false }, { width: 375, touch: true }]) {
    const how = `${width} px${touch ? ", taps and a finger" : ""}`;
    await check(`Extrude in the view: both outlines offered, a click chooses one, the preview and a dragged arrow, Enter makes it (${how})`, async () => {
      const page = await fresh(width, touch);
      const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
      await press("#extrude");
      // Both sketches, then the box's six flat faces (UX1c).
      await until(page, (want) => document.querySelector("#viewport").dataset.extrudeProfiles === want, `${RECT.id} ${CIRCLE.id} ${BOX_FACES}`, "both outlines offered, then the box's faces", panelState);
      // The newest is chosen first (Sketch 2, the circle): 64π · 10 = 2010.6 mm³ previewed.
      assert.equal(await page.textContent("#extrude-profile"), "Sketch 2");
      await until(page, () => Math.abs(Number(document.querySelector("#extrude-panel").dataset.previewVolume) - 640 * Math.PI) < 1e-6, null, "the circle's preview");
      // Hover: over the rectangle's middle it lights, beside it nothing.
      const rect = await hoverAt(page, RECT.centre, RECT.id);
      await hoverAt(page, [-40, 45, 0], "");
      await hoverAt(page, CIRCLE.centre, CIRCLE.id);
      // A click (a tap) on the rectangle chooses it: 1200 · 10 = 12,000 mm³ previewed.
      if (touch) await page.touchscreen.tap(rect.x, rect.y);
      else await page.mouse.click(rect.x, rect.y);
      await until(page, (id) => document.querySelector("#viewport").dataset.extrudeChosen === id, RECT.id, "the rectangle chosen");
      assert.equal(await page.textContent("#extrude-profile"), "Sketch 1");
      await until(page, () => document.querySelector("#extrude-panel").dataset.previewVolume === "12000", null, "the rectangle's preview");
      assert.equal(await view(page, "extrudePreview"), "true");
      // The chosen fill and its preview are bluer than the circle's offered fill (a pixel probe at each one's middle; the pointer off both).
      await page.mouse.move(5, 5);
      const chosen = await pixel(page, await screen(page, [-40, 15, 5]));
      const offered = await pixel(page, await screen(page, CIRCLE.centre));
      assert.ok(chosen[2] > chosen[0] + 30, `the preview is blue: ${chosen}`);
      assert.ok(chosen[2] > offered[2] + 15, `the chosen one (${chosen}) is brighter than the one offered (${offered})`);
      if (shots) await page.screenshot({ path: `${shots}/extrude-preview-${width}.png` });
      // The arrow dragged up its own line by 90 px: a whole number of mm, more than 10, and the box, the arrow and the preview agree.
      await dragArrow(page, 90, touch);
      await until(page, () => document.querySelector("#extrude-distance").value !== "10", null, "the distance changed by the drag");
      const up = Number(await page.inputValue("#extrude-distance"));
      assert.ok(Number.isInteger(up) && up > 10, `dragged up to ${up} mm`);
      assert.equal(await view(page, "extrudeDistance"), String(up));
      await until(page, (v) => document.querySelector("#extrude-panel").dataset.previewVolume === v, String(RECT.area * up), `the preview at ${up} mm`);
      if (shots) await page.screenshot({ path: `${shots}/extrude-dragged-${width}.png` });
      // Dragged back down past the plane: negative, the arrow now pointing down.
      // As far down the screen as the foot is above the plane's point under it, and 120 px more.
      const { foot } = await arrow(page);
      const base = await screen(page, RECT.centre);
      await dragArrow(page, -(Math.hypot(foot[0] - base.x, foot[1] - base.y) + 120), touch);
      await until(page, () => Number(document.querySelector("#extrude-distance").value) < 0, null, "a negative distance");
      const down = Number(await page.inputValue("#extrude-distance"));
      assert.ok(Number.isInteger(down), `dragged down to ${down} mm`);
      await until(page, (v) => document.querySelector("#extrude-panel").dataset.previewVolume === v, String(RECT.area * -down), `the preview at ${down} mm`);
      const after = await arrow(page);
      assert.ok(after.tip[1] > after.foot[1], "the arrow points down the screen");
      if (shots) await page.screenshot({ path: `${shots}/extrude-below-${width}.png` });
      // Enter (focus left on the view by the drag) or OK: the body made, one undo step.
      assert.equal(await page.inputValue("#extrude-distance"), String(down), "the distance is still the one dragged to");
      await until(page, () => !document.querySelector("#extrude-ok").disabled, null, "OK on");
      if (touch) await page.tap("#extrude-ok");
      else await page.keyboard.press("Enter");
      await until(page, (v) => document.querySelector("#volume")?.textContent === v, `${(RECT.area * -down).toLocaleString("en")} mm³`, "the body made", panelState);
      assert.equal(await undoTitle(page), "Undo Extrude Sketch 1 (Ctrl+Z)");
      assert.equal(await view(page, "extrudeProfiles"), "", "the outlines are gone");
      assert.equal(await view(page, "arrow"), "", "the arrow is gone");
      // A preview still being built when Enter came is freed a moment later; one never freed keeps the count up.
      await untilBodies(page, 2, "the box and the extrude; no preview kept", 8000);
      if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");
      await page.context().close();
    });

    await check(`A flat face of the box (UX1c): not tinted until the pointer is on it, a click chooses it, the preview and a dragged arrow, OK makes a new body, one undo step (${how})`, async () => {
      const page = await fresh(width, touch);
      const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
      // The top face's own colour before Extrude opens, at its middle.
      await page.mouse.move(5, 5);
      const plain = await pixel(page, await screen(page, BOX.top));
      await press("#extrude");
      await until(page, (want) => document.querySelector("#viewport").dataset.extrudeProfiles?.endsWith(want), BOX_FACES, "the box's faces offered");
      // Nothing chosen (✕), so no preview or arrow of the newest sketch stands over the box on a small screen.
      await press("#extrude-clear");
      await until(page, () => !document.querySelector("#viewport").dataset.arrow, null, "no arrow");
      // The top face's middle, (5, 5, 10): its plain colour while only offered, bluer once the pointer is on it.
      await page.mouse.move(5, 5);
      const at = await screen(page, BOX.top);
      const idle = await pixel(page, at);
      assert.ok(idle.every((c, i) => Math.abs(c - plain[i]) <= 3), `an offered face is drawn as it was (${idle}, before Extrude ${plain})`);
      const top = await hoverAt(page, BOX.top, "face:feature-1/top");
      const lit = await pixel(page, top);
      assert.ok(lit[2] - lit[0] > idle[2] - idle[0] + 10, `the face under the pointer is tinted blue (${lit}) where it was its own colour (${idle})`);
      if (touch) await page.touchscreen.tap(top.x, top.y);
      else await page.mouse.click(top.x, top.y);
      await until(page, () => document.querySelector("#viewport").dataset.extrudeChosen === "face:feature-1/top", null, "the top face chosen");
      assert.equal(await page.textContent("#extrude-profile"), "Face of Box 1");
      // The kernel checks the face's outline first ("Checking Face of Box 1…"), then the status says the body is a new one.
      await until(page, () => /Joining the new body to the one under the face comes with the Combine tool\.$/.test(document.querySelector("#extrude-status").textContent), null, "the status saying the extrude is a new body", panelState);
      // 10 · 10 · 10 = 1,000 mm³ on top of the box.
      await until(page, () => document.querySelector("#extrude-panel").dataset.previewVolume === "1000", null, "the face's preview");
      if (shots) await page.screenshot({ path: `${shots}/face-extrude-${width}.png` });
      await dragArrow(page, 60, touch);
      await until(page, () => document.querySelector("#extrude-distance").value !== "10", null, "dragged");
      const up = Number(await page.inputValue("#extrude-distance"));
      assert.ok(Number.isInteger(up) && up > 10, `dragged up to ${up} mm`);
      await until(page, (v) => document.querySelector("#extrude-panel").dataset.previewVolume === v, String(100 * up), `the preview at ${up} mm`);
      await press("#extrude-ok");
      await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel gone");
      assert.equal(await undoTitle(page), "Undo Extrude Face of Box 1 (Ctrl+Z)");
      await untilBodies(page, 2, "the box and the new body", 8000);
      await press("#undo");
      await untilBodies(page, 1, "one undo: only the box", 8000);
      assert.equal(await undoTitle(page), "Nothing to undo", "the face's sketch went with it");
      await page.context().close();
    });

    await check(`Escape after a drag leaves nothing behind (${how})`, async () => {
      const page = await fresh(width, touch);
      const before = await undoTitle(page);
      await (touch ? page.tap("#extrude") : page.click("#extrude"));
      await until(page, () => document.querySelector("#extrude-panel")?.dataset.previewVolume !== "", null, "a preview");
      await until(page, () => document.querySelector("#viewport").dataset.arrow, null, "the arrow");
      await dragArrow(page, 60, touch);
      await until(page, () => document.querySelector("#extrude-distance").value !== "10", null, "dragged");
      await page.keyboard.press("Escape");
      await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel gone");
      assert.equal(await view(page, "extrudeProfiles"), "");
      assert.equal(await view(page, "extrudePreview"), "");
      assert.equal(await undoTitle(page), before, "nothing recorded");
      await untilBodies(page, 1, "only the box", 8000);
      await page.context().close();
    });
  }
  await check("no errors in the console", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`${failed} extrude-drag check(s) failed`);
  process.exit(1);
}
