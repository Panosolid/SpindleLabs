// Browser check of a phone held sideways and of touch details the phone
// hunt of 11-01 found (styles: properties-fold.css, phone-float.css,
// view-controls.css, phone-short.css, print-preview.css, phone-sheet.css,
// timeline-bar.css, timeline-marker.css, slice-print.css; viewer.ts).
// 1. Sideways (852 × 393, 874 × 402, 956 × 440, 667 × 375, 740 × 360) the
//    page keeps the desktop layout, whose Properties card under the view
//    cube had 86 to 104 px: a tool's numbers and its OK and Cancel were cut
//    off and under the view's controls. With Move, Edit, Extrude and the
//    sketch's plane picker open, every control of the tool is on the
//    screen once scrolled to in its card and its centre is the control
//    (elementFromPoint), the card takes the view's height (or all its
//    words need), no view control is under it, and the Finish bar shows
//    with its Finish (or the planes) on screen and tappable.
// 2. The print preview's Show card ran under the play bar sideways: it
//    stays clear of the bar, and every choice in it is tappable.
// 3. On a touch screen held sideways the Properties boxes' text is 16 px
//    (smaller makes iOS Safari zoom in), and a new Move leaves the focus
//    alone (no keyboard over the view).
// 4. Slice for printing's Close is inside the dialog at 320, 340 and 375 px, its buttons within the status's scroll margin.
// 5. At 393 × 852 the timeline's buttons, items and marker take a tap the
//    row's whole height (40 px), buttons and items a little wider than they
//    look; sideways they stay close to their width, since timeline.mjs needs
//    each gap's middle and the 3 px past the last item to be the row's.
// 6. Two fingers on the toolbar, timeline and view controls never zoom the
//    page (their touch-action allows no pinch).
// 7. Turning the phone upright keeps the part inside the view.
// 8. A Move handle held: a second finger never moves the camera, and a
//    cancelled touch puts the handle's number back (Chromium: real touches).
// Every geometric check was red on the build before these fixes (run with
// E2E_DIST naming another build's folder). Screenshots go to E2E_SHOTS.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { chooseFile, startWithBox } from "./start.mjs";
import { HOME, screenPoint } from "./sketch-screen.mjs";

const server = await preview({ build: { outDir: process.env.E2E_DIST || "dist" }, preview: { port: 4260, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4260/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const failures = [];
/** A check that records its failure and carries on, so one run shows every red one; the run fails at the end. */
function check(ok, what) {
  if (!ok) failures.push(what);
}

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: browserName !== "firefox" });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, true);
  return { page, context };
}

/** Taps the box's top corner in the home view, picking it for Move. */
async function tapBox(page) {
  const box = await page.locator("#viewport canvas").boundingBox();
  const s = screenPoint(box, [20, 15, 20], HOME);
  await page.touchscreen.tap(s.x, s.y);
}

/**
 * Every control in `root` (and the Finish bar): scrolled to in its card as a person would, then whether it is wholly
 * on the screen and its centre is the control; and the card itself against the view and the view's controls.
 */
async function reachAll(page, root) {
  return page.evaluate((root) => {
    const bad = [];
    const name = (e) => e.id || e.getAttribute("aria-label") || e.textContent.trim().slice(0, 20);
    const controls = [...document.querySelectorAll(`${root} :is(button, input, select), #phone-float button`)].filter((e) => e.getClientRects().length && !e.closest("[hidden]"));
    for (const e of controls) {
      e.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const on = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
      const tappable = hit === e || e.contains(hit) || [...(e.labels ?? [])].some((l) => l.contains(hit));
      if (!on || !tappable) bad.push(`${name(e)} at ${[r.left, r.top, r.width, r.height].map(Math.round)} under ${hit?.id || hit?.className}`);
    }
    const card = document.querySelector("#properties").getBoundingClientRect();
    const view = document.querySelector("#viewport").getBoundingClientRect();
    const props = document.querySelector("#properties");
    const roomy = props.clientHeight >= Math.min(props.scrollHeight, view.height - 16) - 2;
    // The bar's buttons as far as they show: a bar that scrolls sideways clips them to its own box.
    const navBar = document.querySelector("#viewport .view-controls").getBoundingClientRect();
    const nav = [...document.querySelectorAll("#viewport .view-controls button")].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect())
      .map((r) => ({ left: Math.max(r.left, navBar.left), right: Math.min(r.right, navBar.right), top: r.top, bottom: r.bottom })).filter((r) => r.right > r.left);
    const overlap = nav.filter((r) => r.right > card.left + 1 && r.left < card.right - 1 && r.bottom > card.top + 1 && r.top < card.bottom - 1).length;
    const bar = document.querySelector("#phone-float");
    const barShown = !!bar && !bar.hidden && bar.getClientRects().length > 0 && getComputedStyle(bar).display !== "none";
    return { bad, roomy, card: Math.round(props.clientHeight), view: Math.round(view.height), overlap, barShown, count: controls.length };
  }, root);
}

// 1. Sideways: Move, Extrude, Edit and the plane picker.
for (const [width, height] of [[852, 393], [874, 402], [956, 440], [667, 375], [740, 360]]) {
  const { page, context } = await open(width, height);
  const at = `${width} × ${height}`;
  const tools = [
    ["Move", "#move-panel", async () => {
      await page.tap("#move");
      await tapBox(page);
      await page.waitForFunction(() => /Box/.test(document.querySelector("#move-panel")?.textContent ?? ""));
    }],
    ["Extrude", "#extrude-panel", async () => {
      await page.tap("#extrude");
      await page.waitForSelector("#extrude-panel", { state: "visible" });
    }],
    ["Edit", "#feature-edit", async () => {
      await page.locator("#timeline li.timeline-bar-item").first().tap();
      await page.locator("#timeline [data-more]").first().tap();
      await page.tap("#row-menu-edit");
      await page.waitForSelector("#feature-edit", { state: "visible" });
    }],
    ["the plane picker", "#properties", async () => {
      await page.tap("#create-sketch");
      await page.waitForSelector("#sketch-plane-XY", { state: "visible" });
    }],
  ];
  for (const [tool, root, start] of tools) {
    await start();
    await page.waitForTimeout(300);
    const r = await reachAll(page, root);
    if (shots) await page.screenshot({ path: `${shots}/sideways-${tool.replace(/ /g, "-")}-${width}x${height}.png` });
    check(r.count > 2, `${at} ${tool}: its controls found (${r.count})`);
    check(r.bad.length === 0, `${at} ${tool}: controls off the screen or under something: ${r.bad.join("; ")}`);
    check(r.roomy, `${at} ${tool}: the card has ${r.card} px of the view's ${r.view}`);
    check(r.overlap === 0, `${at} ${tool}: ${r.overlap} view controls under the card`);
    check(r.barShown, `${at} ${tool}: the Finish bar shows`);
    // Finish the tool by Cancel (the bar's, or the panel's when there is no bar).
    if (await page.isVisible("#float-cancel")) await page.tap("#float-cancel");
    else await page.evaluate(() => [...document.querySelectorAll("#move-cancel, #extrude-cancel, #feature-edit-cancel, #sketch-cancel")].find((b) => b.getClientRects().length && !b.closest("[hidden]"))?.click());
    await page.waitForTimeout(300);
  }
  // 3. A touch screen sideways: 16 px text in the Properties boxes, and Move gives no box the focus.
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    await page.tap("#move");
    await page.waitForSelector("#move-panel", { state: "visible" });
    const focus = await page.evaluate(() => document.activeElement?.id ?? "");
    check(focus !== "move-x", `${at}: a new Move on touch leaves the X box unfocused (focus on ${focus})`);
    await tapBox(page);
    await page.waitForSelector("#move-x", { state: "visible" });
    const fonts = await page.$$eval("#properties :is(input:not([type=checkbox]):not([type=radio]):not([type=range]), select)", (es) => es.filter((e) => e.getClientRects().length).map((e) => `${e.id} ${getComputedStyle(e).fontSize}`));
    check(fonts.length > 0 && fonts.every((f) => f.endsWith(" 16px")), `${at}: the Properties boxes' text is 16 px on touch: ${fonts.join(", ")}`);
    await page.evaluate(() => document.querySelector("#move-cancel")?.click());
  }
  await context.close();
}
console.log("checked - sideways: Move, Extrude, Edit and the plane picker reachable with the Finish bar");

// 2. The print preview sideways.
for (const [width, height] of [[852, 393], [667, 375]]) {
  const { page, context } = await open(width, height);
  await chooseFile(page, "file-slice-print", true);
  await page.waitForSelector("#slice-print-dialog[open]");
  await page.tap("#slice-print-preview");
  await page.waitForSelector("#print-preview[open] #print-preview-view canvas", { timeout: 60000 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const show = document.querySelector("#print-preview-show").getBoundingClientRect();
    const bar = document.querySelector("#print-preview .print-preview-bar").getBoundingClientRect();
    const bad = [];
    for (const b of document.querySelectorAll("#print-preview-show button:not(:disabled)")) {
      if (!b.getClientRects().length || getComputedStyle(b).display === "none") continue;
      b.scrollIntoView({ block: "nearest", inline: "nearest" });
      const q = b.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (hit !== b && !b.contains(hit)) bad.push(`${b.id || b.textContent.trim()} under ${hit?.id || hit?.className}`);
    }
    return { clear: show.bottom <= bar.top, show: Math.round(show.bottom), bar: Math.round(bar.top), bad };
  });
  if (shots) await page.screenshot({ path: `${shots}/sideways-print-preview-${width}x${height}.png` });
  check(r.clear, `${width} × ${height}: the print preview's Show card (to ${r.show}) clear of the play bar (from ${r.bar})`);
  check(r.bad.length === 0, `${width} × ${height}: print preview choices not tappable: ${r.bad.join("; ")}`);
  await context.close();
}
console.log("checked - sideways print preview: the Show card clear of the play bar, every choice tappable");

// 4. Slice for printing at 320, 340 and 375 px: every button inside the dialog's box, and the sticky row of buttons no
// taller than the status's scroll margin, so advice scrolled into view is never under them (the buttons wrapped onto two
// rows, 122 px, under a 76 px margin: slice-print-fixes.mjs's floating part at 375 px, merge queue 11-01).
for (const width of [320, 340, 375]) {
  const { page, context } = await open(width, 640);
  await chooseFile(page, "file-slice-print", true);
  await page.waitForSelector("#slice-print-dialog[open]");
  const { out, bar, margin } = await page.$eval("#slice-print-dialog", (d) => {
    const box = d.getBoundingClientRect();
    const out = [...d.querySelectorAll(".slice-print-actions button")].filter((b) => { const r = b.getBoundingClientRect(); return r.left < box.left || r.right > box.right; }).map((b) => b.id);
    const bar = d.querySelector(".slice-print-actions").getBoundingClientRect().height;
    const margin = parseFloat(getComputedStyle(d.querySelector("#slice-print-status")).scrollMarginBottom);
    return { out, bar, margin };
  });
  check(out.length === 0, `${width} px: Slice for printing's buttons out of the dialog: ${out.join(", ")}`);
  check(bar <= margin, `${width} px: Slice for printing's buttons ${bar} px tall, over the status's ${margin} px scroll margin`);
  await context.close();
}
console.log("checked - 320, 340 and 375 px: Slice for printing's Close inside the dialog, its buttons within the status's scroll margin");

// 5 and 6. Upright: the timeline's tap areas, and pinch-proof bars.
{
  const { page, context } = await open(393, 852);
  const t = await page.evaluate(() => {
    const row = document.querySelector("#timeline").getBoundingClientRect();
    const small = [];
    for (const e of document.querySelectorAll("#timeline :is(.timeline-marker-button, .timeline-bar-item, .timeline-bar-marker)")) {
      // The tap area: how far across and up the points that land on the element (or its ::before) reach from its centre.
      const r = e.getBoundingClientRect();
      // Whole pixels from the middle out each way (a half pixel past the screen's last row finds nothing), counted both ways.
      const cx = Math.floor(r.left + r.width / 2), cy = Math.floor(r.top + r.height / 2);
      const on = (x, y) => { const h = document.elementFromPoint(x, y); return h === e || e.contains(h); };
      const reach = (dx, dy) => { let d = 0; while (d < 40 && on(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
      const w = reach(-1, 0) + reach(1, 0) + 1, hgt = reach(0, -1) + reach(0, 1) + 1;
      // The row's height (38 of its 39 px inside the top line), and wider than it looks (a button 8 px, an item 4 px; the
      // marker keeps its 14 px across, its gaps being the row's own).
      const wider = e.matches(".timeline-marker-button") ? 8 : e.matches(".timeline-bar-item") ? 4 : 10;
      if (w < Math.floor(r.width) + wider - 2 || hgt < 38) small.push(`${e.getAttribute("aria-label") || e.className} ${w}×${hgt} (looks ${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    return { small, height: Math.round(row.height) };
  });
  check(t.small.length === 0, `393: timeline tap areas short of the row's height or no wider than they look: ${t.small.join(", ")}`);
  check(t.height <= 40, `393: the timeline row is ${t.height} px (at most 40, layout.mjs)`);
  // A touch's allowed gestures are those of the element and every ancestor (touch-action is not inherited, it is intersected):
  // a pinch zooms the page only when every one of them allows it.
  const pinchable = await page.evaluate(() => [["the toolbar", "#toolbar button"], ["the timeline", "#timeline .timeline-bar-item"], ["the view controls", "#viewport .view-controls button"]]
    .filter(([, sel]) => {
      for (let e = document.querySelector(sel); e; e = e.parentElement) if (!/auto|manipulation|pinch-zoom/.test(getComputedStyle(e).touchAction)) return false;
      return true;
    }).map(([n]) => n));
  check(pinchable.length === 0, `393: two fingers would zoom the page on ${pinchable.join(", ")}`);
  if (shots) await page.screenshot({ path: `${shots}/upright-timeline-393.png` });

  await context.close();
}
// 7. Opened sideways, then turned upright: the part still fits the view (the box's corners inside the canvas).
{
  const { page, context } = await open(852, 393);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(600);
  // The box's eight corners projected with the camera the app reports, against the canvas.
  const fits = await page.evaluate(() => {
    const cam = window.fissionTest.camera();
    const canvas = document.querySelector("#viewport canvas").getBoundingClientRect();
    const [px, py, pz] = cam.position, [tx, ty, tz] = cam.target, [ux, uy, uz] = cam.up;
    const f = [tx - px, ty - py, tz - pz]; const fl = Math.hypot(...f); f.forEach((v, i) => (f[i] = v / fl));
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const s = cross(f, [ux, uy, uz]); const sl = Math.hypot(...s); s.forEach((v, i) => (s[i] = v / sl));
    const u = cross(s, f);
    const t = Math.tan(Math.PI / 8), aspect = canvas.width / canvas.height; // the view's 45° vertical field
    const out = [];
    for (const x of [0, 40]) for (const y of [0, 30]) for (const z of [0, 20]) {
      const d = [x - px, y - py, z - pz];
      const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      const nx = (d[0] * s[0] + d[1] * s[1] + d[2] * s[2]) / depth / (t * aspect), ny = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / depth / t;
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) out.push([x, y, z, nx.toFixed(2), ny.toFixed(2)]);
    }
    return out;
  });
  check(fits.length === 0, `393 after turning: box corners outside the view ${JSON.stringify(fits)}`);
  if (shots) await page.screenshot({ path: `${shots}/upright-after-turning-393.png` });
  await context.close();
}
console.log("checked - upright: timeline tap areas, no page pinch on the bars; the part fits after turning upright");

// 8. A Move handle held (Chromium's real touch input).
if (browserName === "chromium") {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const ending of ["second finger", "cancel"]) {
    const { page, context } = await open(393, 852);
    await page.tap("#move");
    await tapBox(page);
    await page.waitForFunction(() => !!document.getElementById("viewport").dataset.moveHandles);
    const said = await page.evaluate(() => document.getElementById("viewport").dataset.moveHandles);
    const words = said.split(" ");
    const [x, y] = words[words.indexOf("x") + 1].split(",").map(Number);
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([px, py, id]) => ({ x: px, y: py, id })) });
    const camera = () => page.evaluate(() => JSON.stringify(window.fissionTest.camera().position));
    await touch("touchStart", [[x, y, 1]]);
    for (let i = 1; i <= 6; i++) { await touch("touchMove", [[x + i * 6, y + i * 2, 1]]); await sleep(16); }
    const dragged = await page.inputValue("#move-x");
    check(dragged !== "0", `the X arrow dragged (the X box ${dragged})`);
    if (ending === "second finger") {
      const before = await camera();
      await touch("touchStart", [[x + 36, y + 12, 1], [100, 300, 2]]);
      for (let i = 1; i <= 8; i++) { await touch("touchMove", [[x + 36, y + 12, 1], [100 + i * 15, 300 + i * 10, 2]]); await sleep(16); }
      await touch("touchEnd", []);
      await page.waitForTimeout(300);
      const after = await camera();
      // Equal to well within a micrometre (OrbitControls' own update rounds in the last digits).
      check(JSON.parse(before).every((v, i) => Math.abs(v - JSON.parse(after)[i]) < 1e-6), `a second finger while a Move handle is held leaves the camera alone (${before} then ${after})`);
    } else {
      await touch("touchCancel", []);
      await page.waitForTimeout(300);
      check((await page.inputValue("#move-x")) === "0", `a cancelled handle drag puts X back to 0 (it is ${await page.inputValue("#move-x")})`);
    }
    await context.close();
  }
  console.log("checked - a held Move handle: a second finger never moves the camera; a cancelled touch puts the number back");
}

await browser.close();
server.close?.();
assert.deepEqual(failures, [], "phone sideways and touch checks");
assert.deepEqual(errors, [], "no page errors");
console.log("ok - phone sideways and touch checks");
process.exit(0);
