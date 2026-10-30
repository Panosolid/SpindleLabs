// Browser check that every drop-down list in the app reads clearly when
// opened. A select's open list is drawn by the browser, not the page: on
// Windows Chrome it once showed the print preview's speeds (1×, 10×, 100×)
// as near-white words on a white list, since the select's light words
// carried into a list the browser painted white (the page never said it
// was dark). The rule the app keeps (styles/dark-select.css): every select
// asks for a dark list (color-scheme: dark) and gives its options a solid
// dark background with light words. So here, with the box built, the
// Slice dialog, its print preview, the Properties panel and the AI panel
// open, every select on the page is read: its color-scheme has dark, and
// every option's background is opaque, dark and at least 4.5:1 against
// its words (WCAG AA). A planted list with light words and no background
// (the bug as it was) must fail the same check. At 1280 px with clicks
// and 375 px with taps. Run with `npm run e2e` (after `npm run build`);
// SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4199, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4199/";
const browser = await launch();
const shots = process.env.SHOTS;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.stack ?? e}`);
  }
}

/** Every select on the page: its id, color-scheme and each option's words and background, as the browser computed them. */
const readSelects = (page) =>
  page.$$eval("select", (ss) =>
    ss.map((s) => ({
      id: s.id || s.outerHTML.slice(0, 60),
      scheme: getComputedStyle(s).colorScheme,
      options: [...s.options].filter((o) => !o.hidden).map((o) => ({ text: o.textContent, color: getComputedStyle(o).color, background: getComputedStyle(o).backgroundColor })),
    })),
  );

/** "rgb(a, b, c)" or "rgba(a, b, c, d)" as [r, g, b, alpha]. */
function rgba(css) {
  const n = css.match(/[\d.]+/g)?.map(Number);
  assert.ok(n && n.length >= 3, `a colour: ${css}`);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Throws naming the select and option when an open list would be hard to read or light. */
function assertReadable(sel) {
  assert.match(sel.scheme, /\bdark\b/, `${sel.id} asks for a dark list (color-scheme ${sel.scheme})`);
  assert.ok(sel.options.length > 0, `${sel.id} has options to read`);
  for (const o of sel.options) {
    const bg = rgba(o.background), fg = rgba(o.color);
    assert.equal(bg[3], 1, `${sel.id} "${o.text}": a solid background, not ${o.background}`);
    assert.ok(luminance(bg) < 0.05, `${sel.id} "${o.text}": a dark background like the app's, not ${o.background}`);
    const c = contrast(bg, fg);
    assert.ok(c >= 4.5, `${sel.id} "${o.text}": ${o.color} on ${o.background} is ${c.toFixed(2)}:1, under 4.5:1`);
  }
}

await check("the check itself: worked contrasts, and the bug as it was fails", () => {
  // Hand-worked: white is luminance 1, black 0, so (1 + 0.05) / (0 + 0.05) = 21.
  assert.equal(contrast([255, 255, 255], [0, 0, 0]).toFixed(2), "21.00");
  // #767676 is the classic lightest grey that passes on white: its channel 118/255 = 0.4627,
  // ((0.4627 + 0.055) / 1.055)^2.4 = 0.1812, so (1.05) / (0.1812 + 0.05) = 4.54, just over 4.5.
  assert.equal(contrast([255, 255, 255], [118, 118, 118]).toFixed(2), "4.54");
  // The bug: the preview's light words (#e6e9ee-ish) over the browser's white list, no background of its own.
  const bug = { id: "planted", scheme: "normal", options: [{ text: "1×", color: "rgb(230, 233, 238)", background: "rgba(0, 0, 0, 0)" }] };
  assert.throws(() => assertReadable(bug), /dark list/);
  assert.throws(() => assertReadable({ ...bug, scheme: "dark" }), /solid background/);
  // A solid white list with the light words: solid, but light and unreadable.
  assert.throws(() => assertReadable({ ...bug, scheme: "dark", options: [{ ...bug.options[0], background: "rgb(255, 255, 255)" }] }), /dark background/);
  // Dark but with dim words: #3a3f46 on #161d2a is well under 4.5:1.
  assert.throws(() => assertReadable({ ...bug, scheme: "dark", options: [{ ...bug.options[0], color: "rgb(58, 63, 70)", background: "rgb(22, 29, 42)" }] }), /under 4.5:1/);
});

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: every drop-down list opens dark and readable`, async () => {
    const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap });
    const page = await context.newPage();
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
      await page.goto(url);
      await startWithBox(page, tap);
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      const inDialog = await readSelects(page);
      await press("#slice-print-preview");
      await page.waitForSelector("#print-preview[open] #print-preview-view canvas", { timeout: 60000 });
      if (shots) await page.screenshot({ path: `${shots}/select-lists-${width}-preview.png` });
      const all = new Map([...inDialog, ...(await readSelects(page))].map((s) => [s.id, s]));
      // The AI panel's selects are in the page from the start (its settings), as is Properties' Shape.
      for (const id of ["print-preview-speed", "shape", "ai-provider", "ai-vendor"]) assert.ok(all.has(id), `#${id} found: ${[...all.keys()]}`);
      assert.ok([...all.keys()].some((id) => id.startsWith("slice-print")), `the Slice dialog's selects found: ${[...all.keys()]}`);
      for (const s of all.values()) if (s.options.length) assertReadable(s);
      console.log(`  ${all.size} selects read: ${[...all.keys()].join(", ")}`);
    } finally {
      await context.close();
    }
  });
}

await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("PASS every drop-down list opens dark and readable");
