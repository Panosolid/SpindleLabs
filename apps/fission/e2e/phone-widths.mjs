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

assert.deepEqual(errors, [], "console errors");
console.log("ok - no errors in the console");
await browser.close();
await server.close();
