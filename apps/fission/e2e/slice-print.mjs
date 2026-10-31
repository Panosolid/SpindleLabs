// Browser check of Slice for printing (H2a, W6c): with the 40 × 30 × 20 mm box
// built, File ▾ > Slice for printing opens its dialog on the P1S's
// defaults, says the file is a first version, and Slice and download
// saves the P1S's print file (.gcode.3mf) the slicing engine wrote in the
// app's own kernel worker: a ZIP whose G-code matches its MD5, for the
// textured plate, 20 mm / 0.2 mm = 100 layers, each marked in the file.
// Plain G-code for another printer saves the same layers. Other choices
// change the file's name and its layers (0.16 mm: the first layer 0.2 mm,
// then (20 − 0.2) / 0.16 = 123.75, so 124 more: 125). At a desktop width
// with clicks and a phone's with taps.
// Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

async function fresh(width, tap, height = tap ? 667 : 800) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
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

/** The files of a ZIP of stored files (the engine never compresses): name → bytes. */
function storedZip(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    assert.equal(v.getUint16(at + 8, true), 0, "stored");
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const start = at + 30 + nameLen + v.getUint16(at + 28, true);
    out.set(b.subarray(at + 30, at + 30 + nameLen).toString("utf8"), b.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

/** The layers a G-code file marks. */
const layersIn = (gcode) => (gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length;

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: Slice for printing downloads the box's P1S print file on the defaults, then plain G-code, 100 layers and 125 at 0.16 mm`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      assert.deepEqual(await page.$$eval("#slice-print-dialog select", (ss) => ss.map((s) => s.value)), ["p1s", "textured", "0.2", "2", "15", "off"], "the P1S's file and defaults");
      assert.match(await page.textContent("#slice-print-untested"), /haven't been test-printed yet/);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-${width}-open.png` });
      // On the screen at phone width too.
      const box = await page.$eval("#slice-print-dialog", (d) => d.getBoundingClientRect().toJSON());
      assert.ok(box.left >= 0 && box.right <= width, `on screen: ${JSON.stringify(box)}`);

      const [p1s] = await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      assert.equal(p1s.suggestedFilename(), "spindlelabs-0.2mm-2w-15pc-textured.gcode.3mf");
      const files = storedZip(readFileSync(await p1s.path()));
      const plate = files.get("Metadata/plate_1.gcode");
      assert.ok(plate, `the plate's G-code is in it: ${[...files.keys()]}`);
      assert.equal(files.get("Metadata/plate_1.gcode.md5").toString("utf8"), createHash("md5").update(plate).digest("hex").toUpperCase(), "the MD5 the printer checks");
      assert.equal(layersIn(plate.toString("utf8")), 100, "20 mm / 0.2 mm");
      assert.match(files.get("Metadata/plate_1.json").toString("utf8"), /"bed_type":"textured_plate"/);
      // Bambu Studio loads the settings (and so opens the file) only when the
      // model names Bambu Studio and a version; Ben's 10-31 file was refused.
      assert.match(files.get("3D/3dmodel.model").toString("utf8"), /<metadata name="Application">BambuStudio-\d+\.\d+\.\d+\.\d+<\/metadata>/, "the model names the maker Bambu Studio checks");
      assert.match(files.get("Metadata/project_settings.config").toString("utf8"), /"printer_settings_id": "Bambu Lab P1S 0\.4 nozzle"/, "Bambu Studio's own P1S preset");
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      assert.match(await page.textContent("#slice-print-status"), /^Saved spindlelabs-0\.2mm-2w-15pc-textured\.gcode\.3mf: 100 layers, /);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-${width}-p1s.png` });

      // Plain G-code for another printer: the plate greys out.
      await page.selectOption("#slice-print-format", "gcode");
      assert.equal(await page.$eval("#slice-print-plate", (s) => s.disabled), true);
      const [file] = await Promise.all([page.waitForEvent("download"), press("#slice-print-go")]);
      assert.equal(file.suggestedFilename(), "spindlelabs-0.2mm-2w-15pc.gcode");
      const gcode = readFileSync(await file.path(), "utf8");
      assert.equal(layersIn(gcode), 100, "20 mm / 0.2 mm");
      assert.match(gcode, /^G28/m, "it homes the printer first");
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved spindlelabs-0.2mm-2w-15pc.gcode"));
      assert.match(await page.textContent("#slice-print-status"), /^Saved spindlelabs-0\.2mm-2w-15pc\.gcode: 100 layers, \d+(\.\d)? g of PLA \(\d+\.\d\d m of filament\), about (\d+ min|\d+ h( \d+ min)?|under a minute) of printing \(plus heating and levelling\)\.$/);
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

// The dialog fits (Ben 10-31: on a laptop Supports was cut off and could not be reached; 470 px high, where the
// old one-column dialog cut it, is the regression case). On a laptop-height
// window every choice and button is on screen without scrolling; on a phone the buttons stay in view and
// every choice can be scrolled to inside the dialog.
for (const [width, height, tap] of [[1280, 650, false], [1366, 600, false], [1280, 470, false], [375, 667, true], [393, 852, true]]) {
  await check(`${width} × ${height}${tap ? ", taps" : ""}: every choice of Slice for printing can be reached, the buttons always on screen`, async () => {
    const page = await fresh(width, tap, height);
    try {
      await chooseFile(page, "file-slice-print", tap);
      await page.waitForSelector("#slice-print-dialog[open]");
      const ids = ["slice-print-format", "slice-print-plate", "slice-print-quality", "slice-print-walls", "slice-print-infill", "slice-print-supports", "slice-print-close", "slice-print-preview", "slice-print-go"];
      /** Each control's box against the window and the dialog's visible area: the ids not wholly inside both. */
      const hidden = () =>
        page.evaluate((ids) => {
          const d = document.getElementById("slice-print-dialog").getBoundingClientRect();
          return ids.filter((id) => {
            const r = document.getElementById(id).getBoundingClientRect();
            return !(r.top >= Math.max(0, d.top) - 0.5 && r.bottom <= Math.min(innerHeight, d.bottom) + 0.5 && r.left >= 0 && r.right <= innerWidth);
          });
        }, ids);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-fit-${width}x${height}.png` });
      // No list squashed to fit (the old dialog shrank Supports' list until its words were cut): all six the same height.
      const heights = await page.$$eval("#slice-print-dialog select", (ss) => ss.map((s) => Math.round(s.getBoundingClientRect().height)));
      assert.ok(heights.every((h) => Math.abs(h - heights[0]) <= 1), `list heights ${heights}`);
      if (!tap) {
        assert.deepEqual(await hidden(), [], "all on screen without scrolling");
      } else {
        // The buttons are always in view; each choice comes into view when the dialog scrolls to it.
        for (const id of ids.slice(0, 6)) {
          await page.$eval(`#${id}`, (e) => e.scrollIntoView({ block: "nearest" }));
          const out = await hidden();
          assert.ok(!out.includes(id), `${id} reachable: ${out}`);
          assert.ok(!out.some((x) => x.startsWith("slice-print-") && ["slice-print-close", "slice-print-preview", "slice-print-go"].includes(x)), `buttons in view: ${out}`);
        }
      }
    } finally {
      await page.context().close();
    }
  });
}

// A window too short even for the compact dialog: the mouse wheel over it scrolls it until Supports is in view, the buttons staying put.
await check("1280 × 420: the wheel scrolls the dialog to Supports, the buttons always on screen", async () => {
  const page = await fresh(1280, false, 420);
  try {
    await chooseFile(page, "file-slice-print", false);
    await page.waitForSelector("#slice-print-dialog[open]");
    const box = await page.$eval("#slice-print-dialog", (d) => d.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    const fits = (id) =>
      page.$eval(`#${id}`, (e) => {
        const r = e.getBoundingClientRect();
        const d = e.closest("dialog").getBoundingClientRect();
        return r.top >= Math.max(0, d.top) - 0.5 && r.bottom <= Math.min(innerHeight, d.bottom) + 0.5;
      });
    assert.ok(await fits("slice-print-supports"), "Supports scrolled into view");
    assert.ok(await fits("slice-print-go"), "Slice and download still in view");
    if (shots) await page.screenshot({ path: `${shots}/slice-print-fit-1280x420-scrolled.png` });
  } finally {
    await page.context().close();
  }
});

await browser.close();
await server.close();
if (errors.length) {
  failed++;
  console.log(`not ok - page errors:\n  ${errors.join("\n  ")}`);
}
if (failed) process.exit(1);
