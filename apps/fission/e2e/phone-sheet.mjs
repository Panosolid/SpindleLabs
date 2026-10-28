// Browser check that on a phone the page itself never scrolls (U5b,
// styles/phone-sheet.css): at 375 × 667 and 667 × 375, with a body in the
// project, the page is exactly the window's height (scrolling to the bottom
// moves nothing), the 3D view takes what the bar, toolbar, toggles and
// timeline leave, Properties and Browser open as sheets over the view from
// the bottom edge (one at a time, at most 60% of the workspace, scrolling
// inside themselves, the view not resized), and File ▾'s list opens as a
// sheet at the bottom, full width. Run with the new rules off (the body's
// classes removed) the page scrolls, as it did when Properties stacked under
// the view. Screenshots go to E2E_SHOTS when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";
import { TOP, clickPlane } from "./sketch-screen.mjs";
import { untilBodies } from "./browser.mjs";

const server = await preview({ preview: { port: 4206, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4206/?test-hooks"; // fissionTest.bodyCount() for the Finish Extrude check
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height, rules = true) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, true);
  if (!rules) await page.evaluate(() => document.body.classList.remove("phone-sheet"));
  return { page, context };
}
/** How far the page can scroll: the document's extra height, and where scrolling to the bottom took it. */
async function pageScroll(page) {
  return page.evaluate(async () => {
    window.scrollTo(0, 99999);
    document.scrollingElement.scrollTop = 99999;
    const moved = window.scrollY;
    let extra = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
    // The workspace scrolled inside itself (the old layout's way: overflow auto) counts as the page scrolling.
    const ws = document.querySelector("#workspace");
    if (["auto", "scroll"].includes(getComputedStyle(ws).overflowY)) extra = Math.max(extra, ws.scrollHeight - ws.clientHeight);
    window.scrollTo(0, 0);
    return { moved, extra };
  });
}
const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, hidden: getComputedStyle(e).display === "none" }; });

for (const [width, height] of [[375, 667], [667, 375]]) {
  const { page, context } = await open(width, height);
  let s = await pageScroll(page);
  assert.deepEqual([s.moved, s.extra <= 0], [0, true], `${width}: the page scrolls (${JSON.stringify(s)})`);
  const view0 = await box(page, "#viewport");
  if (width < 641) assert.ok(view0.height >= 400, `375: the view is ${view0.height} px tall`); // 667 - 44 bar - 45 toolbar - 44 toggles - 33 timeline = about 500
  if (width < 641) {
    // Properties starts closed, so the view (and Undo and Redo docked in it) is clear; its toggle opens it.
    assert.equal((await box(page, "#properties")).hidden, true, "375: Properties starts closed");
    await page.tap("#properties-toggle");
    const props = await box(page, "#properties");
    const ws = await box(page, "#workspace");
    assert.equal(props.hidden, false, "375: Properties opens");
    assert.ok(Math.abs(props.bottom - ws.bottom) < 1, "375: Properties sits on the bottom edge");
    assert.ok(props.height <= ws.height * 0.6 + 1, `375: Properties is ${props.height} of ${ws.height}`); // 60% of the workspace
    assert.equal((await box(page, "#viewport")).height, view0.height, "375: the view is not resized");
    s = await pageScroll(page);
    assert.deepEqual([s.moved, s.extra <= 0], [0, true], "375: the page scrolls with Properties open");
    const inner = await page.$eval("#properties", (e) => { e.scrollTop = 9999; return { can: e.scrollHeight > e.clientHeight, moved: e.scrollTop > 0 }; });
    assert.equal(inner.can, inner.moved, "375: the sheet scrolls inside itself when its words are taller than it");
    if (shots) await page.screenshot({ path: `${shots}/phone-sheet-properties-${width}x${height}.png` });
    await page.tap("#browser-toggle");
    assert.equal((await box(page, "#properties")).hidden, true, "375: opening the Browser closes Properties");
    assert.equal((await box(page, "#browser")).hidden, false, "375: the Browser opens");
    if (shots) await page.screenshot({ path: `${shots}/phone-sheet-browser-${width}x${height}.png` });
    await page.tap("#browser-toggle");
    assert.equal((await box(page, "#browser")).hidden, true, "375: the toggle closes it");
    await page.tap("#file-menu");
    const menu = await box(page, "#file-menu-menu");
    assert.ok(Math.abs(menu.bottom - height) < 1 && menu.left === 0 && menu.right === width, `375: File ▾ is a sheet at the bottom ${JSON.stringify(menu)}`);
    if (shots) await page.screenshot({ path: `${shots}/phone-sheet-menu-${width}x${height}.png` });
    await page.keyboard.press("Escape");
  } else if (shots) await page.screenshot({ path: `${shots}/phone-sheet-${width}x${height}.png` });
  await context.close();
}

// Sweep bugs 9, 15, 16 (2026-10-28): the AI sheet and Properties are one at a time and a tap on the view closes either; a sketch started
// sideways and turned upright still shows its plane prompt; Escape with Menu open closes Menu only.
{
  const { page, context } = await open(375, 667);
  const sheetsOpen = () => page.evaluate(() => ({ assistant: !document.getElementById("assistant").hidden, properties: document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", browser: document.getElementById("browser-toggle").getAttribute("aria-expanded") === "true" }));
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  await page.waitForSelector("#assistant", { state: "visible" });
  await page.tap("#properties-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: true, browser: false }, "9: opening Properties closes the AI sheet");
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: true, properties: false, browser: false }, "9: opening the AI sheet closes Properties");
  await page.tap("#browser-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: false, browser: true }, "9: opening the Browser closes the AI sheet");
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: true, properties: false, browser: false }, "9: opening the AI sheet closes the Browser");
  if (shots) await page.screenshot({ path: `${shots}/phone-ai-sheet-375.png` });
  const top = await page.$eval("#assistant", (e) => e.getBoundingClientRect().top);
  await page.touchscreen.tap(187, Math.max(120, top / 2 + 40));
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: false, browser: false }, "9: a tap on the view puts the AI sheet away");
  assert.equal(await page.getAttribute("#assistant-toggle", "aria-pressed"), "false", "9: the AI button says it is off");
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await startWithBox(page, true);
  await page.tap("#create-sketch");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const b = document.getElementById("float-plane-XY"); // the plane prompt's planes are on the bar over the view at phone width (iPhone notes 10-28)
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { sheet: document.getElementById("properties-toggle").getAttribute("aria-expanded"), shown: r.width > 0 && r.height > 0, hittable: hit === b || b.contains(hit) };
  });
  assert.deepEqual(s, { sheet: "false", shown: true, hittable: true }, `15: a sketch started sideways and turned upright shows its plane prompt, with the view clear ${JSON.stringify(s)}`);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(200);
  assert.equal(await page.isVisible("#float-plane-XY"), true, "15: and again after turning back and forth");
  // 16: Menu open over the prompt, Escape: Menu closes, the prompt stays.
  await page.tap("#menu-toggle");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "false", "16: Escape closes Menu");
  assert.equal(await page.isVisible("#float-plane-XY"), true, "16: and does not also cancel the plane prompt");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#float-plane-XY"), false, "16: a second Escape cancels the prompt as before");
  await context.close();
}

// Sweep bugs 9, 15, 16 (2026-10-28): the AI sheet and Properties are one at a time and a tap on the view closes either; a sketch started
// sideways and turned upright still shows its plane prompt; Escape with Menu open closes Menu only.
{
  const { page, context } = await open(375, 667);
  const sheetsOpen = () => page.evaluate(() => ({ assistant: !document.getElementById("assistant").hidden, properties: document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", browser: document.getElementById("browser-toggle").getAttribute("aria-expanded") === "true" }));
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  await page.waitForSelector("#assistant", { state: "visible" });
  await page.tap("#properties-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: true, browser: false }, "9: opening Properties closes the AI sheet");
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: true, properties: false, browser: false }, "9: opening the AI sheet closes Properties");
  await page.tap("#browser-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: false, browser: true }, "9: opening the Browser closes the AI sheet");
  await page.tap("#menu-toggle");
  await page.tap("#assistant-toggle");
  assert.deepEqual(await sheetsOpen(), { assistant: true, properties: false, browser: false }, "9: opening the AI sheet closes the Browser");
  if (shots) await page.screenshot({ path: `${shots}/phone-ai-sheet-375.png` });
  const top = await page.$eval("#assistant", (e) => e.getBoundingClientRect().top);
  await page.touchscreen.tap(187, Math.max(120, top / 2 + 40));
  assert.deepEqual(await sheetsOpen(), { assistant: false, properties: false, browser: false }, "9: a tap on the view puts the AI sheet away");
  assert.equal(await page.getAttribute("#assistant-toggle", "aria-pressed"), "false", "9: the AI button says it is off");
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await startWithBox(page, true);
  await page.tap("#create-sketch");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const b = document.getElementById("float-plane-XY"); // the plane prompt's planes are on the bar over the view at phone width (iPhone notes 10-28)
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { sheet: document.getElementById("properties-toggle").getAttribute("aria-expanded"), shown: r.width > 0 && r.height > 0, hittable: hit === b || b.contains(hit) };
  });
  assert.deepEqual(s, { sheet: "false", shown: true, hittable: true }, `15: a sketch started sideways and turned upright shows its plane prompt, with the view clear ${JSON.stringify(s)}`);
  // 16: Menu open over the prompt, Escape: Menu closes, the prompt stays.
  await page.tap("#menu-toggle");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "false", "16: Escape closes Menu");
  assert.equal(await page.isVisible("#float-plane-XY"), true, "16: and does not also cancel the plane prompt");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#float-plane-XY"), false, "16: a second Escape cancels the prompt as before");
  await context.close();
}

// Ben's iPhone notes (10-28), at the iPhone 15 Pro's 393 × 852 with taps: (1) Finish Sketch and Extrude's OK were hidden (the
// toolbar's far end, the closed Properties sheet), so the bar over the view (phone-float.ts) holds a green Finish and Cancel
// while a tool is open, on screen and on top even with Properties open; (2) a tool ending puts the Properties sheet away;
// (3) Create Sketch no longer opens the sheet over the view: the bar says "Tap a plane or face" with the three planes.
{
  const { page, context } = await open(393, 852);
  const sheet = () => page.getAttribute("#properties-toggle", "aria-expanded");
  /** The element's box, whether it is all inside the window, and whether a tap at its middle lands on it (nothing over it). */
  const reach = (sel) => page.$eval(sel, (b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onScreen: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tappable: hit === b || b.contains(hit), height: r.height, disabled: b.disabled ?? false };
  });
  const sketching = (on) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketching === String(w), on);
  // The control first: with nothing open the bar is not shown.
  assert.equal(await page.isVisible("#phone-float"), false, "no tool open: no bar");
  await page.tap("#create-sketch");
  await page.waitForSelector("#phone-float", { state: "visible" });
  assert.equal(await sheet(), "false", "3: Create Sketch leaves the Properties sheet shut, the view clear");
  assert.match(await page.textContent("#phone-float"), /Tap a plane or face/);
  for (const p of ["XY", "XZ", "YZ"]) assert.deepEqual(await reach(`#float-plane-${p}`), { onScreen: true, tappable: true, height: 44, disabled: false }, `3: the ${p} plane on the bar`);
  const cube = await page.$eval("#phone-float", (b) => b.getBoundingClientRect().right);
  assert.ok(cube <= 393 - 96, `3: the bar stops left of the view cube (its right edge at ${cube})`);
  if (shots) await page.screenshot({ path: `${shots}/phone-float-pick-393.png` });
  await page.tap("#float-plane-XY");
  await sketching(true);
  assert.equal(await page.textContent("#float-finish"), "Finish Sketch");
  assert.deepEqual(await reach("#float-finish"), { onScreen: true, tappable: true, height: 44, disabled: false }, "1: Finish Sketch on screen and tappable");
  // A rectangle, so there is something to extrude: the tool, then two opposite corners (snapping to the grid is off, SF1).
  await page.tap("#sketch-tool-rectangle");
  await clickPlane(page, [5, 5], TOP, true);
  await clickPlane(page, [25, 20], TOP, true);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketchPoints?.split(" ").length >= 4);
  // Properties opened by hand (Ben's screenshot): the bar is still over it, and Finish closes it.
  await page.tap("#properties-toggle");
  assert.equal(await sheet(), "true");
  assert.equal((await reach("#float-finish")).tappable, true, "1: Finish stays on top of the open sheet");
  if (shots) await page.screenshot({ path: `${shots}/phone-float-finish-sketch-393.png` });
  await page.tap("#float-finish");
  await sketching(false);
  assert.equal(await sheet(), "false", "2: Finish Sketch puts the Properties sheet away");
  assert.equal(await page.isVisible("#phone-float"), false, "the bar goes with the tool");
  // Extrude: Finish Extrude makes the body (two bodies, the box and the rectangle's), then the sheet is away.
  await page.tap("#extrude");
  await page.waitForFunction(() => document.querySelector("#float-finish")?.textContent === "Finish Extrude" && !document.querySelector("#float-finish").disabled);
  assert.deepEqual(await reach("#float-finish"), { onScreen: true, tappable: true, height: 44, disabled: false }, "1: Finish Extrude on screen and tappable");
  assert.equal(await page.isVisible("#float-cancel"), true, "Extrude has Cancel on the bar too");
  await page.tap("#properties-toggle");
  if (shots) await page.screenshot({ path: `${shots}/phone-float-finish-extrude-393.png` });
  await page.tap("#float-finish");
  await untilBodies(page, 2);
  await page.waitForSelector("#phone-float", { state: "hidden" });
  assert.equal(await sheet(), "false", "2: Finish Extrude puts the Properties sheet away");
  // With no closed outline to use (a new, empty sketch is the newest), Finish Extrude is off, as the panel's OK is; Cancel ends it.
  await page.tap("#create-sketch");
  await page.tap("#float-plane-XZ");
  await sketching(true);
  await page.tap("#float-finish");
  await sketching(false);
  await page.tap("#extrude");
  await page.waitForFunction(() => document.querySelector("#float-finish")?.textContent === "Finish Extrude");
  await page.waitForTimeout(300);
  assert.equal(await page.$eval("#float-finish", (b) => b.disabled), await page.$eval("#extrude-ok", (b) => b.disabled), "Finish Extrude is off exactly when OK is");
  await page.tap("#properties-toggle");
  await page.tap("#float-cancel");
  await page.waitForSelector("#phone-float", { state: "hidden" });
  assert.equal(await sheet(), "false", "2: Cancel puts the sheet away too");
  assert.equal(await page.isVisible("#extrude-panel"), false, "Cancel ended Extrude");
  await untilBodies(page, 2);
  await context.close();
}
// Ben's rule (10-28): on a phone one tap must never suddenly cover the view when the person may not want that. Each toolbar
// tool (not a menu's ▾, whose list is what was asked for) is tapped at 393 × 852 and at most 40% of the 3D view may be covered
// afterwards (a 12 × 12 grid of points over the view, each covered when what is on top there is outside it). Body facts is the
// one tool whose job is to show its numbers in the sheet; Export STL downloads a file and opens nothing.
{
  const SHOWS_ITS_SHEET = new Set(["inspect-facts", "tool-export_stl"]);
  const { page, context } = await open(393, 852);
  const covered = () => page.evaluate(() => {
    const v = document.getElementById("viewport").getBoundingClientRect();
    let n = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      const hit = document.elementFromPoint(v.left + ((i + 0.5) * v.width) / 12, v.top + ((j + 0.5) * v.height) / 12);
      if (!hit || !hit.closest("#viewport")) n++;
    }
    return n / 144;
  });
  // The measure can fail: Properties opened by hand covers more than 40% (its 60% sheet, less the toggles' row).
  await page.tap("#properties-toggle");
  const sheetShare = await covered();
  assert.ok(sheetShare > 0.4, `control: an open sheet counts as covering the view (${sheetShare})`);
  await page.tap("#properties-toggle");
  const tools = await page.$$eval("#toolbar button.toolbar-group-tool", (bs) => bs.filter((b) => b.offsetParent && !b.disabled).map((b) => b.id));
  assert.ok(tools.includes("create-sketch") && tools.includes("extrude"), `the tools found: ${tools}`);
  for (const id of tools.filter((t) => !SHOWS_ITS_SHEET.has(t))) {
    await page.tap(`#${id}`);
    await page.waitForTimeout(400);
    const share = await covered();
    if (shots) await page.screenshot({ path: `${shots}/one-tap-${id}-393.png` });
    assert.ok(share <= 0.4, `one tap on ${id} covers ${Math.round(share * 100)}% of the view`);
    if (await page.isVisible("#float-cancel")) await page.tap("#float-cancel");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#phone-float", { state: "hidden" });
  }
  await context.close();
}
// Wide screens keep the tool's own buttons in sight: no bar.
{
  const { page, context } = await open(1280, 800);
  await page.click("#create-sketch");
  await page.waitForSelector("#sketch-plane-XY", { state: "visible" });
  assert.equal(await page.isVisible("#phone-float"), false, "1280: no bar over the view");
  await context.close();
}

// Rules off, the old layout: Properties stacked under the view and the page scrolled.
{
  const { page, context } = await open(375, 667, false);
  const s = await pageScroll(page);
  await page.tap("#properties-toggle");
  const t = await pageScroll(page);
  assert.ok(s.extra > 0 || t.extra > 0 || t.moved > 0, "off: the old layout should scroll");
  await context.close();
}

await browser.close();
server.close?.();
assert.deepEqual(errors, []);
console.log("phone-sheet: ok");
process.exit(0);
