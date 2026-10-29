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
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel, startWithBox } from "./start.mjs";
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
    assert.ok(props.height <= ws.height * 0.45 + 1, `375: Properties is ${props.height} of ${ws.height}`); // 45% of the workspace, under half the view
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
  // The new look floats the Browser and Properties toggles over the view's top (phone-sheet.css): the bar sits under them, never over (merging main, 10-29).
  for (const t of ["#browser-toggle", "#properties-toggle"]) assert.equal((await reach(t)).tappable, true, `${t} still tappable with the bar shown`);
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
  // WebKit moves a tap's click onto a button near the finger (CI run 40805491664: a corner tapped 15 px under the bar
  // finished the sketch). Its events, made here: a press that begins on the view, then the click on Finish. The sketch stays.
  await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 120, clientY: 270 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: 120, clientY: 270 }));
    document.getElementById("float-finish").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 120, clientY: 255 }));
  });
  await page.waitForTimeout(300);
  assert.equal(await page.$eval("#viewport", (v) => v.dataset.sketching), "true", "a tap on the view whose click WebKit moves onto Finish leaves the sketch open");
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
  await page.fill("#extrude-distance", "10"); // Extrude starts at 0 mm (Ben, 2026-10-28)
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
  // Weak-spot hunt 10-29: the dimmed Finish said nothing on touch (its reason sat in the closed sheet and a title never shows):
  // the bar now says why in words, the panel's own status line, on screen without opening anything.
  assert.equal(await page.$eval("#float-finish", (b) => b.disabled), true, "no closed outline: Finish Extrude is off");
  assert.equal(await sheet(), "false", "the sheet is still shut");
  const status = (await page.textContent("#extrude-status")).trim();
  assert.ok(status.length > 0, "the panel has a reason");
  assert.equal((await page.textContent("#float-why")).trim(), status, "the bar says why Finish is off");
  assert.equal((await reach("#float-why")).onScreen, true, "and it is on screen");
  if (shots) await page.screenshot({ path: `${shots}/phone-float-why-393.png` });
  await page.tap("#properties-toggle");
  await page.tap("#float-cancel");
  await page.waitForSelector("#phone-float", { state: "hidden" });
  assert.equal(await sheet(), "false", "2: Cancel puts the sheet away too");
  assert.equal(await page.isVisible("#extrude-panel"), false, "Cancel ended Extrude");
  await untilBodies(page, 2);
  // Finish Move with no body picked: Move refuses (its error in the closed sheet), and the bar shows those words.
  await page.tap("#move");
  await page.waitForFunction(() => document.querySelector("#float-finish")?.textContent === "Finish Move");
  assert.equal(await page.isVisible("#float-why"), false, "nothing wrong yet: no words");
  await page.tap("#float-finish");
  await page.waitForSelector("#float-why", { state: "visible" });
  assert.equal((await page.textContent("#float-why")).trim(), (await page.textContent("#move-error")).trim(), "the bar repeats Move's refusal");
  assert.equal((await reach("#float-why")).onScreen, true, "on screen");
  await page.tap("#float-cancel");
  await page.waitForSelector("#phone-float", { state: "hidden" });
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

// The clean look on a phone (UX2b, after Life360): Browser and Properties are
// pill buttons floating over the view's top (the row they took went back to
// the view), Undo and Redo round 48 px buttons, the view buttons 44 px to tap
// (Apple's 44 pt), and every sheet has a grab handle.
async function phoneLook(page) {
  return page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    const style = (sel) => getComputedStyle(document.querySelector(sel));
    const toggles = [...document.querySelectorAll("#panel-toggles button")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
    const handle = getComputedStyle(document.querySelector("#browser"), "::before");
    return {
      toolbarBottom: rect("#toolbar").bottom,
      viewTop: rect("#viewport").top,
      toggles: toggles.map((r) => ({ top: r.top, height: r.height })),
      undo: { w: rect("#undo").width, h: rect("#undo").height, radius: parseFloat(style("#undo").borderTopLeftRadius) },
      navHeights: [...document.querySelectorAll("#view-controls button")].map((b) => b.getBoundingClientRect().height),
      handle: { content: handle.content, w: parseFloat(handle.width), h: parseFloat(handle.height) },
      // Read from the rules (the Properties sheet is closed): its size boxes, each at least this tall and this big a text.
      sizeBoxes: ["#width", "#depth", "#height"].map((sel) => ({ sel, minHeight: parseFloat(style(sel).minHeight) || 0, font: parseFloat(style(sel).fontSize) })),
    };
  });
}
function checkPhoneLook(m) {
  assert.ok(Math.abs(m.viewTop - m.toolbarBottom) <= 1, `the view starts right under the toolbar (${m.viewTop} vs ${m.toolbarBottom})`);
  assert.ok(m.toggles.length === 2 && m.toggles.every((t) => t.top >= m.viewTop && t.height >= 44), `Browser and Properties float over the view, 44 px or more (${JSON.stringify(m.toggles)})`);
  // Round: a 48 × 48 button with corners of at least half its side, 24 px.
  assert.ok(m.undo.w === 48 && m.undo.h === 48 && m.undo.radius >= 24, `Undo is a round 48 px button (${JSON.stringify(m.undo)})`);
  assert.ok(m.navHeights.length > 0 && m.navHeights.every((h) => h >= 44), `the view buttons are 44 px or more (${m.navHeights})`);
  assert.ok(m.handle.content === '""' && m.handle.w === 40 && m.handle.h === 5, `a sheet has its 40 × 5 grab handle (${JSON.stringify(m.handle)})`);
  // 44 px to tap, and 16 px text or more, below which iOS Safari zooms the page in on a tap (weak-spot hunt A21: 29 px, 13.3 px).
  assert.ok(m.sizeBoxes.every((b) => b.minHeight >= 44 && b.font >= 16), `the size boxes are 44 px tall with 16 px text (${JSON.stringify(m.sizeBoxes)})`);
}
{
  const { page, context } = await open(375, 667);
  checkPhoneLook(await phoneLook(page));
  if (shots) await page.screenshot({ path: `${shots}/phone-look-375.png` });
  // It can fail: without the phone rules the toggles take a row above the view and no sheet has a handle;
  // with the old buttons Undo is a 44 px square and the view buttons 30 px.
  await page.evaluate(() => document.body.classList.remove("phone-sheet"));
  await assert.rejects(async () => checkPhoneLook(await phoneLook(page)), /the view starts right under the toolbar|float over the view/);
  await page.evaluate(() => document.body.classList.add("phone-sheet"));
  const old = await page.addStyleTag({ content: ".undo-redo.docked button#undo:not(#none), .undo-redo.docked button#redo:not(#none) { width: 44px; height: 44px; border-radius: 4px; }" });
  await assert.rejects(async () => checkPhoneLook(await phoneLook(page)), /Undo is a round 48 px button/);
  await old.evaluate((el) => el.remove());
  const slim = await page.addStyleTag({ content: ".view-controls button.nav-button:not(#no-such-id):not(#none) { height: 30px; min-width: 30px; }" });
  await assert.rejects(async () => checkPhoneLook(await phoneLook(page)), /view buttons are 44 px/);
  await slim.evaluate((el) => el.remove());
  const small = await page.addStyleTag({ content: "#properties label input#width:not(#none) { min-height: 0; font-size: 13px; }" });
  await assert.rejects(async () => checkPhoneLook(await phoneLook(page)), /size boxes are 44 px tall/);
  await small.evaluate((el) => el.remove());
  checkPhoneLook(await phoneLook(page));
  await context.close();
}

// A short phone held sideways (568 × 320 and 640 × 360, weak-spot hunt A F3): with Extrude open and its Properties sheet up
// the Distance box was below the screen's bottom (303..347 at 320 px), so typing a distance meant scrolling the sheet
// first. It is now on the screen and tappable as soon as the sheet opens.
for (const [width, height] of [[568, 320], [640, 360]]) {
  const { page, context } = await open(width, height);
  await page.tap("#extrude");
  await page.waitForSelector("#extrude-panel", { state: "attached" });
  await page.tap("#properties-toggle");
  await page.waitForTimeout(400);
  const d = await page.$eval("#extrude-distance", (b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), onScreen: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight, tappable: hit === b };
  });
  if (shots) await page.screenshot({ path: `${shots}/phone-extrude-${width}x${height}.png` });
  assert.ok(d.onScreen && d.tappable, `${width} × ${height}: Extrude's Distance box on the screen and tappable with the sheet up ${JSON.stringify(d)}`);
  await context.close();
}
console.log("ok - 568 × 320 and 640 × 360: Extrude's Distance box is on the screen and tappable as the sheet opens");

// Ben's iPhone (2026-10-29): dragging a sheet's handle down moved only the handle (the words bounced) and the sheet never
// closed. With real touches (Chrome's touch input, not made-up events) at 375 and 393 px: a drag on the handle moves the
// whole sheet with the finger, a short slow one lets it slide back, a long one closes it (a flick's speed is
// timed in e2e/sheet-drag.test.mjs: Chrome's touch input arrives a frame apart, too unevenly to time here); once the words are
// scrolled a drag in them scrolls them and does not close it, while the handle still does; the pill tapped again and a tap
// on the view close it too; Browser and Properties take at most 45% of the workspace (under half the view) with nothing selected.
/** A finger on the touchscreen: down at (x, y), moved by `steps` of [dx, dy] `ms` apart, then lifted unless `lift` is false. */
async function finger(cdp, page, x, y, steps, ms, lift = true) {
  const at = (px, py) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(x, y) });
  for (const [dx, dy] of steps) {
    await page.waitForTimeout(ms);
    x += dx;
    y += dy;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(x, y) });
  }
  if (lift) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const down = (px, n) => Array.from({ length: n }, () => [0, px]);
const isOpen = (page, slot) => page.evaluate((s) => (s === "assistant" ? !document.getElementById("assistant").hidden : document.getElementById(`${s}-toggle`).getAttribute("aria-expanded") === "true"), slot);
const sheetTop = (page, slot) => page.$eval(`#${slot}`, (e) => e.getBoundingClientRect().top);
async function openSheet(page, slot) {
  if (slot === "assistant") {
    await page.tap("#menu-toggle");
    await page.tap("#assistant-toggle");
  } else await page.tap(`#${slot}-toggle`);
  await page.waitForSelector(`#${slot}`, { state: "visible" });
  await page.waitForTimeout(250); // the sheet's opening slide (styles/motion.css)
  await page.$eval(`#${slot}`, (e) => { e.scrollTop = 0; }); // a sheet keeps its scroll when put away; each check starts at the top
}
/** Every way a sheet closes, at one width; `tag` names the screenshots. */
async function checkSheetClosing(page, cdp, width, tag) {
  const mid = width / 2;
  const ws = await box(page, "#workspace");
  for (const slot of ["properties", "browser", "assistant"]) {
    await openSheet(page, slot);
    const sheet = await box(page, `#${slot}`);
    if (slot !== "assistant") assert.ok(sheet.height <= ws.height * 0.45 + 1, `${width} ${slot}: the sheet is ${sheet.height} of the workspace's ${ws.height} (at most 45%)`);
    // Held 40 px down by the handle, slowly: the whole sheet follows the finger, not just its handle.
    await finger(cdp, page, mid, sheet.top + 12, down(10, 4), 50, false);
    const held = await sheetTop(page, slot);
    const handleIn = await page.$eval(`#${slot}`, (e) => e.scrollTop);
    if (shots && slot === "properties") await page.screenshot({ path: `${shots}/phone-sheet-drag-${tag}.png` });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(Math.abs(held - sheet.top - 40) <= 2 && handleIn === 0, `${width} ${slot}: the sheet follows the finger 40 px down (its top went from ${sheet.top} to ${held}, its words scrolled ${handleIn})`);
    await page.waitForTimeout(300);
    assert.equal(await isOpen(page, slot), true, `${width} ${slot}: a short slow drag lets the sheet slide back open`);
    assert.ok(Math.abs((await sheetTop(page, slot)) - sheet.top) <= 1, `${width} ${slot}: and back where it was`);
    // A long slow drag closes it.
    await finger(cdp, page, mid, sheet.top + 12, down(10, 16), 50);
    await page.waitForTimeout(300);
    assert.equal(await isOpen(page, slot), false, `${width} ${slot}: a 160 px drag down by the handle closes the sheet`);
    if (slot === "properties" && shots) await page.screenshot({ path: `${shots}/phone-sheet-dragged-shut-${tag}.png` });
    // A tap on the view closes it.
    await openSheet(page, slot);
    await page.touchscreen.tap(mid, Math.max(ws.top + 80, sheet.top - 60));
    await page.waitForTimeout(100);
    assert.equal(await isOpen(page, slot), false, `${width} ${slot}: a tap on the view closes the sheet`);
    if (slot === "assistant") continue;
    // The pill tapped again closes it.
    await openSheet(page, slot);
    await page.tap(`#${slot}-toggle`);
    assert.equal(await isOpen(page, slot), false, `${width} ${slot}: its pill tapped again closes the sheet`);
  }
  // Properties' words scrolled: a drag down in them scrolls them back (the sheet stays), a drag on the handle still closes it.
  await openSheet(page, "properties");
  const props = await box(page, "#properties");
  const scrolled = await page.$eval("#properties", (e) => { e.scrollTop = 80; return e.scrollTop; });
  assert.ok(scrolled > 0, `${width}: Properties' words are taller than its sheet, so they scroll`);
  await finger(cdp, page, mid, props.top + props.height / 2, down(10, 5), 50);
  await page.waitForTimeout(300);
  const after = await page.$eval("#properties", (e) => e.scrollTop);
  assert.equal(await isOpen(page, "properties"), true, `${width}: a drag down in scrolled words does not close the sheet`);
  assert.ok(after < scrolled, `${width}: it scrolls the words back (scrollTop ${scrolled} → ${after})`);
  await page.$eval("#properties", (e) => { e.scrollTop = 80; });
  await finger(cdp, page, mid, props.top + 12, down(10, 16), 50);
  await page.waitForTimeout(300);
  assert.equal(await isOpen(page, "properties"), false, `${width}: the handle closes it even with its words scrolled`);
}
if (browserName === "chromium") {
  for (const [width, height, tag] of [[375, 667, "375"], [393, 852, "393"]]) {
    const { page, context } = await open(width, height);
    const cdp = await context.newCDPSession(page);
    await checkSheetClosing(page, cdp, width, tag);
    if (width === 393) {
      await openSheet(page, "properties");
      if (shots) await page.screenshot({ path: `${shots}/phone-sheet-properties-393.png` });
      await page.tap("#properties-toggle");
      // It can fail: with the sheet's drag gone (its touches stopped before they reach it) the sheet stays put under the finger,
      // and at the old 60% Properties covers more than 45% of the workspace.
      await page.evaluate(() => { window.__noDrag = (e) => e.stopImmediatePropagation(); for (const t of ["touchstart", "touchmove", "touchend"]) window.addEventListener(t, window.__noDrag, { capture: true, passive: true }); });
      await assert.rejects(checkSheetClosing(page, cdp, width, "broken"), /the sheet follows the finger/);
      await page.evaluate(() => { for (const t of ["touchstart", "touchmove", "touchend"]) window.removeEventListener(t, window.__noDrag, { capture: true }); });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
      if (await isOpen(page, "properties")) await page.tap("#properties-toggle");
      const tall = await page.addStyleTag({ content: ".phone-sheet :is(#browser, #properties):not(#none):not(#no-such-id) { max-height: 60%; }" });
      await assert.rejects(checkSheetClosing(page, cdp, width, "broken"), /at most 45%/);
      await tall.evaluate((el) => el.remove());
      if (await isOpen(page, "properties")) await page.tap("#properties-toggle");
      await checkSheetClosing(page, cdp, width, "393-again");
    }
    await context.close();
  }
}

// The checks' own sheet helpers (start.mjs) when the app moves a sheet just before their press lands: the app shuts
// Properties as a tool ends, so a sheet read as open can be shut by the time the press arrives and the press opens it
// again. Merge-queue flake 2026-10-29 (extrude-drag at 375 px): the helper then waited 30 s for a state that never came.
// Here a one-off listener shuts (or opens) the sheet as the press begins, before the toggle's own click.
{
  const { page, context } = await open(375, 667);
  const flipFirst = (closed) => page.evaluate((c) => {
    const t = document.getElementById("properties-toggle");
    t.addEventListener("pointerdown", () => (c ? t.dispatchEvent(new CustomEvent("sheet-close")) : t.click()), { once: true, capture: true });
  }, closed);
  await openPanel(page, "properties", true);
  await flipFirst(true); // the app shuts it as the press begins; the press then opens it again
  await closePanels(page, true);
  assert.equal(await isOpen(page, "properties"), false, "closePanels leaves Properties shut though the app shut it first");
  await flipFirst(false); // the app opens it as the press begins; the press then shuts it again
  await openPanel(page, "properties", true);
  assert.equal(await isOpen(page, "properties"), true, "openPanel leaves Properties open though the app opened it first");
  // It can fail: a toggle whose press never arrives is reported after three presses, with the state it kept.
  await page.evaluate(() => document.getElementById("properties-toggle").addEventListener("click", (e) => e.stopImmediatePropagation(), { capture: true }));
  await assert.rejects(closePanels(page, true), /#properties-toggle: 3 presses and still aria-expanded="true", not "false"/);
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
