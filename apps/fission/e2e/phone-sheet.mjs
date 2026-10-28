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

const server = await preview({ preview: { port: 4206, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4206/";
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
    const b = document.getElementById("sketch-plane-XY");
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { sheet: document.getElementById("properties-toggle").getAttribute("aria-expanded"), shown: r.width > 0 && r.height > 0, hittable: hit === b || b.contains(hit) };
  });
  assert.deepEqual(s, { sheet: "true", shown: true, hittable: true }, `15: a sketch started sideways and turned upright shows its plane prompt ${JSON.stringify(s)}`);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(200);
  assert.equal(await page.isVisible("#sketch-plane-XY"), true, "15: and again after turning back and forth");
  // 16: Menu open over the prompt, Escape: Menu closes, the prompt stays.
  await page.tap("#menu-toggle");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "false", "16: Escape closes Menu");
  assert.equal(await page.isVisible("#sketch-prompt"), true, "16: and does not also cancel the plane prompt");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#sketch-prompt"), false, "16: a second Escape cancels the prompt as before");
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
    const b = document.getElementById("sketch-plane-XY");
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { sheet: document.getElementById("properties-toggle").getAttribute("aria-expanded"), shown: r.width > 0 && r.height > 0, hittable: hit === b || b.contains(hit) };
  });
  assert.deepEqual(s, { sheet: "true", shown: true, hittable: true }, `15: a sketch started sideways and turned upright shows its plane prompt ${JSON.stringify(s)}`);
  // 16: Menu open over the prompt, Escape: Menu closes, the prompt stays.
  await page.tap("#menu-toggle");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("#menu-toggle", "aria-expanded"), "false", "16: Escape closes Menu");
  assert.equal(await page.isVisible("#sketch-prompt"), true, "16: and does not also cancel the plane prompt");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#sketch-prompt"), false, "16: a second Escape cancels the prompt as before");
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
  checkPhoneLook(await phoneLook(page));
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
