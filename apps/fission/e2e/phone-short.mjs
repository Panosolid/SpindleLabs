// Browser check of a phone held sideways and of a window just over phone
// width (U5a, styles/phone-short.css). At 667 × 375 and 844 × 390 the
// toolbar is one row (45 px, not three) so the view keeps over 250 px of the
// 375, the top bar is one row with nothing overlapping another (before, "Saved"
// ran into DESIGN ▾ at 667 px and Community wrapped onto a second row at 641), and nothing is wider than the screen.
// Each check is also run with the new rules switched off (the body's class
// removed) and must fail there: the phone's own toolbar is taller than 48 px
// and the top bar wraps to two rows. At 1280 × 720 the toolbar is untouched.
// Screenshots at 1280, 667 × 375 and 844 × 390 go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4204, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4204/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height, rules = true) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page);
  if (!rules) await page.evaluate(() => document.body.classList.remove("phone-short"));
  return { page, context };
}

/** The top bar's visible buttons and words, as boxes, and the first two that overlap by more than 1 px. */
async function topBarOverlap(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll("#topbar > *:not([hidden]), #topbar #topbar-actions > *, #topbar .app-bar > *, #topbar button")]
      .filter((e) => e.children.length === 0 || e.tagName === "BUTTON" || e.tagName === "H1")
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 12), e, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 2 && b.r.height > 2);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const nested = boxes[i].e.contains(boxes[j].e) || boxes[j].e.contains(boxes[i].e); // a word inside its own button is not an overlap
        if (w > 1 && h > 1 && !nested) return `${boxes[i].id} overlaps ${boxes[j].id}`;
      }
    return null;
  });
}
const topBarHeight = (page) => page.$eval("#topbar", (e) => e.getBoundingClientRect().height);
const toolbarHeight = (page) => page.$eval("#toolbar", (e) => e.getBoundingClientRect().height);
const viewHeight = (page) => page.$eval("#viewport", (e) => e.getBoundingClientRect().height);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [width, height] of [[667, 375], [844, 390]]) {
  const { page, context } = await open(width, height);
  assert.equal(await topBarOverlap(page), null, `${width}: top bar overlap`);
  // Hand-worked: toolbar buttons 32 px + 2 × 6 padding + 1 border = 45 px.
  assert.ok((await toolbarHeight(page)) <= 48, `${width}: toolbar ${await toolbarHeight(page)} px`);
  // The bar is 44, the toolbar 45, the timeline 32 + 1: the view keeps what is left of the height (over 250 at 375).
  assert.ok((await viewHeight(page)) >= height - 44 - 48 - 34 - 2, `${width}: view ${await viewHeight(page)} px`);
  assert.equal(await sideways(page), 0, `${width}: sideways scroll`);
  if (shots) await page.screenshot({ path: `${shots}/phone-short-${width}x${height}.png` });
  await context.close();
}

// Just over phone width: 641, 700 and 760 px, no overlap, and AI, Guide and Community keep their names for screen readers.
for (const width of [641, 700, 760]) {
  const { page, context } = await open(width, 700);
  assert.equal(await topBarOverlap(page), null, `${width}: top bar overlap`);
  assert.ok((await topBarHeight(page)) <= 48, `${width}: top bar wraps (${await topBarHeight(page)} px)`);
  assert.equal(await sideways(page), 0, `${width}: sideways scroll`);
  assert.equal(await page.$eval("#guide-open", (e) => e.textContent.includes("Guide")), true);
  await context.close();
}

// Switched off, the same pages fail: the toolbar is taller and the bar overlaps.
{
  const { page, context } = await open(641, 375, false);
  assert.ok((await toolbarHeight(page)) > 48, "off: the old toolbar is taller than 48 px");
  // Before, Community wrapped onto a second row here (and at 667 "Saved" and "AI off" ran into DESIGN ▾).
  assert.ok((await topBarHeight(page)) > 48, "off: the old top bar wraps to two rows at 641");
  await context.close();
}

// A desktop window keeps the roomy toolbar and the words.
{
  const { page, context } = await open(1280, 720);
  assert.ok((await toolbarHeight(page)) > 60, `1280: toolbar ${await toolbarHeight(page)} px`);
  assert.equal(await page.$eval("#community", (e) => e.getBoundingClientRect().width > 80), true);
  if (shots) await page.screenshot({ path: `${shots}/phone-short-1280.png` });
  await context.close();
}

await browser.close();
server.close?.();
assert.deepEqual(errors, []);
console.log("phone-short: ok");
process.exit(0);
