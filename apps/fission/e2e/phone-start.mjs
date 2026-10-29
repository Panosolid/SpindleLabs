// Browser check of the first screen on a phone (Ben's iPhone 17 Pro, 402 × 874 in Safari, 2026-10-28): the
// "Start your design" card (start-hint.ts, styles/start-hint.css) must not sit under the floating Browser and
// Properties pills, the view cube, the view controls or Undo/Redo, and must fit inside the 3D view, at every
// phone width from 320 to 440 px, upright and sideways. Before the fix the card sat at the view's top, under the
// pills (they covered its title) and over the view cube. Each size is also run with the card put back where it was
// (at phone width) or over the view cube (wider) and must fail there, so the check can fail. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4243, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4243/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

/** The card, what floats over the view, and the view itself, as boxes. */
const boxes = (page) =>
  page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const shown = (e) => e && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().width > 0;
    const others = [
      ...[...document.querySelectorAll("#panel-toggles button")].filter(shown).map((e) => [e.id || "panel toggle", box(e)]),
      ...[...document.querySelectorAll("#viewport .view-cube, #viewport .view-controls, #undo-redo")].filter(shown).map((e) => [e.id || e.className, box(e)]),
    ];
    return { card: box(document.getElementById("start-hint")), view: box(document.getElementById("viewport")), others };
  });
const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
/** What the card overlaps, and whether it fits in the view. */
function problems({ card, view, others }) {
  const found = others.filter(([, b]) => meets(card, b)).map(([name]) => `covers ${name}`);
  if (card.left < view.left - 0.5 || card.right > view.right + 0.5 || card.top < view.top - 0.5 || card.bottom > view.bottom + 0.5) found.push("leaves the view");
  return found;
}

const sizes = [[320, 568], [375, 667], [393, 852], [402, 874], [440, 956], [568, 320], [667, 375], [852, 393], [874, 402], [956, 440]];
for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#start-hint", { state: "visible" });
  await page.waitForTimeout(400); // past the card's fade-in and the view cube's first draw
  const tag = `${width} × ${height}`;
  if (shots) await page.screenshot({ path: `${shots}/phone-start-${width}x${height}.png` });
  assert.deepEqual(problems(await boxes(page)), [], `${tag}: the start card overlaps what floats over the view`);
  // A card in the wrong place must fail here: at phone width the old rule (the card at the view's top, across it, as
  // before the fix), wider the card in the view's top right corner (over the view cube).
  const old = width <= 640
    ? "top: 16px !important; left: 50% !important; right: auto !important; width: calc(100% - 32px) !important; transform: translateX(-50%) !important;"
    : "top: 8px !important; left: auto !important; right: 8px !important; transform: none !important;";
  await page.addStyleTag({ content: `.start-hint:not(#none):not(#none) { ${old} }` });
  assert.notDeepEqual(problems(await boxes(page)), [], `${tag}: the check must fail with the card in the wrong place`);
  await context.close();
  console.log(`ok - ${tag}: the start card clears the pills, the view cube, the view controls and Undo/Redo, and fits in the view`);
}

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
