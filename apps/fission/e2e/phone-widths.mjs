// Browser check for the phone layout at its widths (U5c): at 320, 414 and 375 px wide and sideways at 667 × 375, with a body in the
// project and every sheet open in turn, nothing is wider than the screen and the page never scrolls; a tap on the view outside a
// sheet puts the sheet away; and sideways (667 × 375, past the sheet rules)
// the browser and Properties stay open over the view's sides as on a desktop. Touch only: every press here is a tap. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4207, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4207/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page, true);
  return { page, context };
}
/** What is wider or taller than the screen, and whether the page can scroll. */
const overflow = (page) =>
  page.evaluate(() => {
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest("canvas, [hidden], .menu-button-menu"))
      .filter((e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return false; } return true; })
      .map((e) => e.id || e.className || e.tagName);
    window.scrollTo(0, 99999);
    return { wide, sideways: document.documentElement.scrollWidth - innerWidth, down: window.scrollY, extra: document.documentElement.scrollHeight - innerHeight };
  });
const expanded = (page, which) => page.getAttribute(`#${which}-toggle`, "aria-expanded");

for (const [width, height] of [[320, 568], [375, 667], [414, 896]]) {
  const { page, context } = await open(width, height);
  const tag = `${width}`;
  let o = await overflow(page);
  assert.deepEqual([o.wide, o.sideways <= 0, o.down, o.extra <= 0], [[], true, 0, true], `${tag}: closed ${JSON.stringify(o)}`);
  // The view's buttons are a strip along the view's bottom, never a card over the sketch's origin: at 320 px they wrapped to
  // three rows over 26-29% of the view (weak-spot hunt A7). At most two rows; below 361 px one, scrolling sideways within the bar.
  const bar = await page.evaluate(() => {
    const b = document.getElementById("view-controls"), v = document.getElementById("viewport").getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const tops = new Set([...b.querySelectorAll("button")].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().top)));
    return { rows: tops.size, share: (r.width * r.height) / (v.width * v.height), scrolls: b.scrollWidth <= b.clientWidth || getComputedStyle(b).overflowX === "auto" };
  });
  assert.ok(bar.rows <= (width < 361 ? 1 : 2) && bar.share <= 0.16 && bar.scrolls, `${tag}: the view's buttons are ${width < 361 ? "one row" : "at most two rows"}, at most 16% of the view, scrolling sideways when they don't fit ${JSON.stringify(bar)}`);
  for (const which of ["browser", "properties"]) {
    await page.tap(`#${which}-toggle`);
    assert.equal(await expanded(page, which), "true");
    o = await overflow(page);
    assert.deepEqual([o.wide, o.sideways <= 0, o.down, o.extra <= 0], [[], true, 0, true], `${tag}: ${which} open ${JSON.stringify(o)}`);
    if (shots) await page.screenshot({ path: `${shots}/phone-${width}-${which}.png` });
    // A tap on the view above the sheet puts the sheet away.
    const sheet = await page.$eval(`#${which}`, (e) => e.getBoundingClientRect().top);
    await page.touchscreen.tap(width / 2, Math.max(sheet / 2 + 60, 140));
    assert.equal(await expanded(page, which), "false", `${tag}: a tap on the view closes ${which}`);
  }
  await context.close();
  console.log(`ok - ${tag} px: nothing wider than the screen, the page never scrolls with the browser or Properties open, a tap on the view closes the sheet`);
}

{
  const { page, context } = await open(667, 375);
  const toggle = await page.isVisible("#browser-toggle");
  const grid = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const b = r("#browser"), v = r("#viewport");
    const p = r("#properties");
    // Both panels are drawn, inside the screen and over the view's sides (the view takes the full width, as on a desktop).
    return { browserVisible: !!b && b.width > 0 && b.left >= 0 && b.bottom <= innerHeight, propertiesVisible: !!p && p.width > 0 && p.right <= innerWidth, viewFull: v.width === innerWidth };
  });
  const o = await overflow(page);
  assert.deepEqual([o.wide, o.sideways <= 0, o.down, o.extra <= 0], [[], true, 0, true], `667: ${JSON.stringify(o)}`);
  assert.equal(toggle, false, "667 × 375: the desktop grid, no panel toggles");
  assert.deepEqual(grid, { browserVisible: true, propertiesVisible: true, viewFull: true }, "667 × 375: the browser and Properties stay open over the view's sides");
  if (shots) await page.screenshot({ path: `${shots}/phone-667-landscape.png` });
  await context.close();
  console.log("ok - 667 × 375: the desktop grid keeps the browser and Properties open over the view's sides, nothing wider than the screen, the page never scrolls");
}

// Sweep bug 10 (2026-10-28): with the AI panel open beside the view (sideways phone, narrow window) the Properties panel must not cover
// the browser's rows, and the view's bar must stay inside the 3D view, clear of the AI panel's Ask button.
for (const [width, height, touch] of [[667, 375, true], [700, 800, false]]) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await startWithBox(page, touch);
  await (touch ? page.tap("#assistant-toggle") : page.click("#assistant-toggle"));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const v = document.getElementById("viewport").getBoundingClientRect();
    const B = document.getElementById("browser").getBoundingClientRect();
    const covered = [...document.querySelectorAll("#browser button, #browser summary")].filter((e) => {
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height || b.bottom > B.bottom || b.top < B.top) return false;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return hit && hit.closest("#properties");
    }).map((e) => e.textContent.trim().slice(0, 14) || e.getAttribute("aria-label"));
    const outside = [...document.querySelectorAll("#view-controls button")].filter((b) => { const q = b.getBoundingClientRect(); return q.width && (q.right > v.right + 1 || q.left < v.left - 1); }).map((b) => b.getAttribute("aria-label") || b.textContent.trim());
    const barCovered = [...document.querySelectorAll("#view-controls button")].filter((e) => { const q = e.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return q.width && !(h === e || e.contains(h)); }).map((e) => e.getAttribute("aria-label") || e.textContent.trim());
    const ask = document.getElementById("ai-ask-button");
    ask.scrollIntoView({ block: "nearest" });
    const ab = ask.getBoundingClientRect();
    const hit = document.elementFromPoint(ab.left + ab.width / 2, ab.top + ab.height / 2);
    return { covered, outside, barCovered, askHittable: hit === ask || ask.contains(hit), askUnder: hit?.getAttribute("aria-label") || hit?.id };
  });
  assert.deepEqual(r.covered, [], `10: ${width}x${height} with the AI panel open, Properties covers browser rows ${JSON.stringify(r)}`);
  assert.deepEqual(r.outside, [], `10: ${width}x${height} the view's bar overflows the view ${JSON.stringify(r)}`);
  assert.deepEqual(r.barCovered, [], `10: ${width}x${height} Properties covers the view's bar ${JSON.stringify(r)}`);
  assert.equal(r.askHittable, true, `10: ${width}x${height} the view's bar lies over Ask ${JSON.stringify(r)}`);
  if (shots) await page.screenshot({ path: `${shots}/phone-ai-open-${width}x${height}.png` });
  await context.close();
  console.log(`ok - ${width} × ${height}: with the AI panel open the browser rows are clear, the view's bar stays in the view and Ask is tappable`);
}

// Sweep bug 22 (2026-10-28): the guide's Close button is on the screen at every phone width down to 320 px.
for (const width of [320, 340, 375]) {
  const context = await browser.newContext({ viewport: { width, height: 568 }, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?guide`);
  await page.waitForSelector("dialog[open]");
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => { const b = document.querySelector("dialog[open] .guide-close").getBoundingClientRect(); return { left: b.left, right: b.right }; });
  if (shots && (width === 320 || width === 375)) await page.screenshot({ path: `${shots}/guide-close-${width}.png` });
  assert.ok(c.left >= 0 && c.right <= width, `22: ${width} px: the guide's Close is at ${c.left}–${c.right}`);
  await page.tap(".guide-close");
  await page.waitForTimeout(200);
  assert.equal(await page.$("dialog[open]"), null, `22: ${width} px: a tap on Close closes the guide`);
  await context.close();
}
console.log("ok - the guide's Close is on the screen at 320, 340 and 375 px");

// Weak-spot hunt A15 (2026-10-29): on a phone held sideways the guide's chapter dots ran taller than the screen (456 px at
// 390) and three sat over Close's right edge, so a thumb on Close jumped chapter. Every dot is on the screen, clear of
// Close and of the Back/Next buttons below.
for (const [width, height] of [[844, 390], [780, 360]]) { // under 760 px wide the guide shows no dots
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?guide`);
  await page.waitForSelector("dialog[open] .guide-rail button");
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const dots = [...document.querySelectorAll("dialog[open] .guide-rail button")].map(box);
    const close = box(document.querySelector("dialog[open] .guide-close"));
    const nav = [...document.querySelectorAll("dialog[open] .guide-nav button")].map(box);
    return {
      dots: dots.length,
      off: dots.filter((d) => d.top < 0 || d.bottom > innerHeight).length,
      onClose: dots.filter((d) => meets(d, close)).length,
      onNav: dots.filter((d) => nav.some((n) => meets(d, n))).length,
    };
  });
  assert.ok(r.dots > 0 && r.off === 0 && r.onClose === 0 && r.onNav === 0, `A15: ${width} × ${height}: the guide's dots ${JSON.stringify(r)}`);
  if (shots) await page.screenshot({ path: `${shots}/guide-dots-${width}x${height}.png` });
  await context.close();
}
console.log("ok - sideways at 844 × 390 and 780 × 360 every guide dot is on the screen, clear of Close and of Back and Next");

assert.deepEqual(errors, [], "console errors");
console.log("ok - no errors in the console");
await browser.close();
await server.close();
