// Browser check of the print preview and its time-lapse (H2b, H2c): with
// the 40 × 30 × 20 mm box built, Slice for printing > Preview opens the
// print in 3D over the page: 100 layers of 0.2 mm, the legend naming the
// walls and infill, the finished part drawn (the middle of the view is not
// the background). The Show card's switches hide kinds of line (the walls
// alone draw less than the whole box, every kind off draws next to
// nothing, Travel adds lines), and with no supports in the slice both
// supports choices are off. The layer slider at layer 1 shows far less plastic than
// at 100; Play lays the print down from the first move, the scrubber moving
// on; a drag orbits the view. Escape closes it. At a desktop width with
// clicks and a phone's with taps, everything on screen.
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4197/";
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
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

async function fresh(width, tap) {
  const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page, tap);
  return page;
}

/**
 * The 3D view's own picture, read from its canvas: not a screenshot of the screen there, which would also
 * catch the Show card and the dock floating over it (their look changes as switches are pressed or the
 * phone's strip scrolls, which once moved the count by 2 %).
 */
const canvasPicture = (page) => page.$eval("#print-preview-view canvas", (c) => c.toDataURL("image/png"));

/** How many of the view's pixels are not its background (#1b1e23) or the plate's greys: the plastic and the nozzle. */
async function coloured(page) {
  const png = await canvasPicture(page);
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    // Saturated pixels only: the background and plate are greys (r, g, b within 40 of each other).
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) n++;
    return n;
  }, png);
}

/** How many of the view's saturated pixels have a hue (degrees) from `lo` to `hi`: solid infill's pink-red is about 345. */
async function hued(page, lo, hi) {
  const png = await canvasPicture(page);
  return page.evaluate(async ([url, lo, hi]) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
      if (max - min <= 40) continue;
      let h = max === r ? ((gg - b) / (max - min)) * 60 : max === gg ? (2 + (b - r) / (max - min)) * 60 : (4 + (r - gg) / (max - min)) * 60;
      if (h < 0) h += 360;
      if (h >= lo && h <= hi) n++;
    }
    return n;
  }, [png, lo, hi]);
}

const setRange = (page, sel, value) => page.$eval(sel, (el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: Preview shows the box's print in 3D, layer by layer, and plays its time-lapse`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      await press("#slice-print-preview");
      await page.waitForSelector("#print-preview[open] #print-preview-view canvas", { timeout: 60000 });
      assert.equal(await page.$eval("#slice-print-dialog", (d) => d.open), false, "the slice dialog gives way");
      assert.equal(await page.getAttribute("#print-preview-layers", "max"), "100", "20 mm / 0.2 mm");
      assert.equal(await page.textContent("#print-preview-layer-words"), "Layer 100 of 100 · 20.00 mm");
      const legend = await page.$$eval("#print-preview-legend li", (ls) => ls.map((l) => l.textContent));
      for (const k of ["Outer wall", "Inner wall", "Solid infill", "Sparse infill"]) assert.ok(legend.includes(k), `legend has ${k}: ${legend}`);
      // Everything on screen at this width.
      for (const sel of ["#print-preview-play", "#print-preview-speed", "#print-preview-scrub", "#print-preview-layers", "#print-preview-close"]) {
        const r = await page.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
        assert.ok(r.left >= 0 && r.right <= width + 0.5 && r.width > 0, `${sel} on screen: ${JSON.stringify(r)}`);
      }
      await page.waitForTimeout(200);
      const whole = await coloured(page);
      assert.ok(whole > 2000, `the finished box is drawn: ${whole} coloured pixels`);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-done.png` });

      // The Show card: no supports in this slice, so both supports choices are off and say why.
      assert.equal(await page.$eval("#print-preview-preset-only-supports", (b) => b.disabled), true);
      assert.equal(await page.$eval("#print-preview-show-support", (b) => b.disabled), true);
      // Infill off: the top's pink solid infill goes (the walls stay, so plenty is still drawn).
      const pink = await hued(page, 330, 359);
      assert.ok(pink > 2000, `the top's solid infill is in view: ${pink}`);
      for (const k of ["solid-infill", "sparse-infill"]) await press(`#print-preview-show-${k}`);
      await page.waitForTimeout(200);
      const walls = await coloured(page);
      const pinkLeft = await hued(page, 330, 359);
      assert.ok(pinkLeft < pink * 0.05 && walls > 2000, `walls alone: ${pinkLeft} pink of ${pink}, ${walls} coloured`);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-walls.png` });
      // Every kind off: next to nothing left (the nozzle).
      for (const id of await page.$$eval("#print-preview-legend button[aria-pressed='true']", (bs) => bs.map((b) => b.id))) await press(`#${id}`);
      await page.waitForTimeout(200);
      const none = await coloured(page);
      assert.ok(none < whole * 0.1, `everything off: ${none} vs ${whole}`);
      // Travel on: its lines appear.
      await press("#print-preview-show-travel");
      await page.waitForTimeout(200);
      const travel = await coloured(page);
      assert.ok(travel > none, `travel lines drawn: ${travel} vs ${none}`);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-travel.png` });
      await press("#print-preview-show-travel");
      await press("#print-preview-preset-all");
      await page.waitForTimeout(200);
      const back = await coloured(page);
      assert.ok(Math.abs(back - whole) < whole * 0.02, `Everything brings it all back: ${back} vs ${whole}`);
      // The Show card on a phone is one strip, never most of the view.
      const card = await page.$eval("#print-preview-show", (e) => e.getBoundingClientRect().toJSON());
      if (tap) assert.ok(card.height <= 60, `the Show strip is one row: ${card.height}px`);

      // Layer 1 alone: far less plastic in view than the whole box.
      await setRange(page, "#print-preview-layers", 1);
      await page.waitForTimeout(200);
      assert.equal(await page.textContent("#print-preview-layer-words"), "Layer 1 of 100 · 0.20 mm");
      const first = await coloured(page);
      assert.ok(first < whole * 0.8, `layer 1 shows less than the whole box: ${first} vs ${whole}`);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-layer1.png` });

      // Halfway up by the slider, then play: the time-lapse runs on from there and the scrubber moves on.
      await setRange(page, "#print-preview-layers", 50);
      const before = Number(await page.inputValue("#print-preview-scrub"));
      await page.selectOption("#print-preview-speed", "10");
      await press("#print-preview-play");
      assert.equal(await page.textContent("#print-preview-play"), "Pause");
      await page.waitForTimeout(800);
      const after = Number(await page.inputValue("#print-preview-scrub"));
      assert.ok(after > before, `the time-lapse moved on: ${before} -> ${after}`);
      await press("#print-preview-play");
      assert.equal(await page.textContent("#print-preview-play"), "Play");
      await page.waitForTimeout(150);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-playing.png` });

      // A drag orbits the view: the picture changes, the clock does not.
      const box = await page.locator("#print-preview-view canvas").boundingBox();
      const stillAt = await page.inputValue("#print-preview-scrub");
      const shot = await page.locator("#print-preview-view canvas").screenshot();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      assert.ok(!shot.equals(await page.locator("#print-preview-view canvas").screenshot()), "the view turned");
      assert.equal(await page.inputValue("#print-preview-scrub"), stillAt);
      if (shots) await page.screenshot({ path: `${shots}/print-preview-${width}-orbited.png` });

      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("print-preview"));
    } finally {
      await page.context().close();
    }
  });
}

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
if (failed) process.exit(1);
