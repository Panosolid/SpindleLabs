// Browser check of the print preview and its time-lapse (H2b, H2c): with
// the 40 × 30 × 20 mm box built, Slice for printing > Preview opens the
// print in 3D over the page: 100 layers of 0.2 mm, the legend naming the
// walls and infill, the finished part drawn (the middle of the view is not
// the background). The layer slider at layer 1 shows far less plastic than
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

/** How many of the view's pixels are not its background (#1b1e23) or the plate's greys: the plastic and the nozzle. */
async function coloured(page) {
  const png = await page.locator("#print-preview-view canvas").screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    // Saturated pixels only: the background and plate are greys (r, g, b within 40 of each other).
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) n++;
    return n;
  }, png.toString("base64"));
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
