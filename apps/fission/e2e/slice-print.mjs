// Browser check of Slice for printing (H2a): with the 40 × 30 × 20 mm box
// built, File ▾ > Slice for printing opens its dialog on the P1S's
// defaults, says the file is a first version, and Slice and download
// saves G-code the slicing engine wrote in the app's own kernel worker:
// 20 mm / 0.2 mm = 100 layers, each marked in the file. Other choices
// change the file's name and its layers (0.16 mm: the first layer 0.2 mm,
// then (20 − 0.2) / 0.16 = 123.75, so 124 more: 125). At a desktop width
// with clicks and a phone's with taps.
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4196/";
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
  const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
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

/** The layers a G-code file marks. */
const layersIn = (gcode) => (gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length;

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: Slice for printing downloads the box's G-code, 100 layers on the defaults and 125 at 0.16 mm`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      assert.deepEqual(await page.$$eval("#slice-print-dialog select", (ss) => ss.map((s) => s.value)), ["0.2", "2", "15"], "the P1S's defaults");
      assert.match(await page.textContent("#slice-print-untested"), /haven't been test-printed yet/);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-${width}-open.png` });
      // On the screen at phone width too.
      const box = await page.$eval("#slice-print-dialog", (d) => d.getBoundingClientRect().toJSON());
      assert.ok(box.left >= 0 && box.right <= width, `on screen: ${JSON.stringify(box)}`);

      const [file] = await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      assert.equal(file.suggestedFilename(), "spindlelabs-0.2mm-2w-15pc.gcode");
      const gcode = readFileSync(await file.path(), "utf8");
      assert.equal(layersIn(gcode), 100, "20 mm / 0.2 mm");
      assert.match(gcode, /^G28/m, "it homes the printer first");
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      assert.match(await page.textContent("#slice-print-status"), /^Saved spindlelabs-0\.2mm-2w-15pc\.gcode: 100 layers, \d+(\.\d)? g of PLA \(\d+\.\d\d m of filament\), about 4 min of printing \(plus heating and levelling\)\.$/);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-${width}-sliced.png` });

      await page.selectOption("#slice-print-quality", "0.16");
      await page.selectOption("#slice-print-walls", "3");
      const [finer] = await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      assert.equal(finer.suggestedFilename(), "spindlelabs-0.16mm-3w-15pc.gcode");
      assert.equal(layersIn(readFileSync(await finer.path(), "utf8")), 125, "0.2 mm, then 124 of 0.16 mm");

      await press("#slice-print-close");
      assert.equal(await page.$eval("#slice-print-dialog", (d) => d.open), false);
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
