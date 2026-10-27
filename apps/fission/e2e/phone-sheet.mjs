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
