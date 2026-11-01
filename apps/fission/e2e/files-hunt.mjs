// Browser checks of the files hunt's fixes (2026-11-01), each a bug once
// seen in a real Chromium:
// - a photo's EXIF orientation (JPEG APP1, PNG eXIf): every one of the
//   eight opens upright, 5–8 with width and height swapped, through Image's
//   Open and through a drop (it was refused as damaged: current Chromium
//   turns the picture even when asked not to);
// - an image too big for the screen's graphics leaves the open image as it was;
// - a dropped folder says it is a folder (Chromium only: CDP drops a real one);
// - a project whose "formatVersion" comes after its first 64 KB still opens;
// - Download STL's note names the file the person typed in the name box.
// The images are made here: stored 40 × 20 pixels in four coloured
// quarters (red, green over blue, white), so where each colour lands shows
// the turn. Run after a build; E2E_DIST serves another build folder.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox, switchTo } from "./start.mjs";

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data) => {
  const body = Buffer.from([...Buffer.from(type, "ascii"), ...data]);
  return Buffer.from([...be32(data.length), ...body, ...be32(crc32(body))]);
};
/** A TIFF block whose first directory holds only the orientation (tag 0112, SHORT, count 1), big-endian. */
const tiff = (o) => [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];
const W = 40;
const H = 20;
const quarter = (x, y) => (y < H / 2 ? (x < W / 2 ? RED : GREEN) : x < W / 2 ? BLUE : WHITE);

/** An RGBA PNG of the quarters (`w` × `h`, colours by `pixel`), with an eXIf chunk after IHDR when `o` is given. */
function makePng(o, w = W, h = H, pixel = quarter) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) rows.push(...pixel(x, y), 255);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", [...be32(w), ...be32(h), 8, 6, 0, 0, 0]),
    ...(o ? [chunk("eXIf", tiff(o))] : []),
    chunk("IDAT", [...deflateSync(Buffer.from(rows))]),
    chunk("IEND", []),
  ]);
}

/** The quarters' colours shown upright, top-left, top-right, bottom-left, bottom-right, worked by hand from stored [R G / B W]. */
const UPRIGHT = {
  1: [RED, GREEN, BLUE, WHITE], // as stored
  2: [GREEN, RED, WHITE, BLUE], // mirrored left to right
  3: [WHITE, BLUE, GREEN, RED], // half a turn
  4: [BLUE, WHITE, RED, GREEN], // mirrored top to bottom
  5: [RED, BLUE, GREEN, WHITE], // across the main diagonal: the first column is the first row
  6: [BLUE, RED, WHITE, GREEN], // a quarter turn clockwise: the first column, read upwards, is the first row
  7: [WHITE, GREEN, BLUE, RED], // across the other diagonal
  8: [GREEN, WHITE, RED, BLUE], // a quarter turn anticlockwise: the last column is the first row
};

const server = await preview({ ...(process.env.E2E_DIST ? { build: { outDir: process.env.E2E_DIST } } : {}), preview: { port: 4211, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4211/";
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

const drop = (selector, files) =>
  page.evaluate(
    ([selector, files]) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name));
      const el = document.querySelector(selector);
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const d = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(d);
      return d.defaultPrevented ? "taken" : "drop not taken";
    },
    [selector, files.map((f) => ({ name: f.name, bytes: [...f.bytes] }))],
  );

/** The colours at the centres of the sheet's four quarters on screen (the sheet: pixels with a channel over 200; the backdrop is under 60). */
const quartersOnScreen = () =>
  page.evaluate(() => {
    const src = document.querySelector("#viewport canvas");
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = 4 * (y * c.width + x);
        if (Math.max(d[i], d[i + 1], d[i + 2]) > 200) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    const at = (fx, fy) => {
      const x = Math.round(x0 + (x1 - x0) * fx);
      const y = Math.round(y0 + (y1 - y0) * fy);
      return Array.from(d.slice(4 * (y * c.width + x), 4 * (y * c.width + x) + 3));
    };
    return { box: [x1 - x0 + 1, y1 - y0 + 1], colours: [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)] };
  });
const near = (got, want, what) => assert.ok(got.every((c, i) => Math.abs(c - want[i]) <= 40), `${what}: got ${got}, want ${want}`);

/** Waits for the open image's pixel size to read `want` (or the error to say something). */
async function opened(want) {
  await page.waitForFunction((want) => document.querySelector("#image-pixels")?.textContent === want || document.querySelector("#image-error")?.textContent, want, { timeout: 10000 });
  await page.waitForTimeout(300);
}

/** Checks the open image is `o` turned upright: its size and where each colour is. */
async function isUpright(o) {
  const [w, h] = o >= 5 ? [H, W] : [W, H];
  assert.equal(await page.textContent("#image-error"), "", "no message");
  assert.equal(await page.textContent("#image-pixels"), `${w} × ${h} px`);
  const { box, colours } = await quartersOnScreen();
  assert.ok(o >= 5 ? box[1] > box[0] : box[0] > box[1], `the sheet on screen is ${box[0]} × ${box[1]}: ${o >= 5 ? "taller than wide" : "wider than tall"}`);
  const names = ["top left", "top right", "bottom left", "bottom right"];
  colours.forEach((c, i) => near(c, UPRIGHT[o][i], `orientation ${o}, ${names[i]}`));
}

try {
  await page.goto(url);
  await startWithBox(page);
  await switchTo(page, "image");

  // The JPEGs: the browser's own encoder writes the quarters, then an EXIF APP1 goes in after the start marker.
  const plainJpeg = Buffer.from(
    await page.evaluate(async ([w, h]) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d");
      for (const [x, y, colour] of [[0, 0, "#f00"], [w / 2, 0, "#0f0"], [0, h / 2, "#00f"], [w / 2, h / 2, "#fff"]]) {
        g.fillStyle = colour;
        g.fillRect(x, y, w / 2, h / 2);
      }
      return [...new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 1 })).arrayBuffer())];
    }, [W, H]),
  );
  const exifJpeg = (o) => {
    const data = [...Buffer.from("Exif\0\0", "latin1"), ...tiff(o)];
    const app1 = Buffer.from([0xff, 0xe1, ((data.length + 2) >> 8) & 255, (data.length + 2) & 255, ...data]);
    return Buffer.concat([plainJpeg.subarray(0, 2), app1, plainJpeg.subarray(2)]);
  };

  for (let o = 1; o <= 8; o++) {
    await check(`a JPEG with EXIF orientation ${o}, through Image's Open, is shown upright${o >= 5 ? ", 20 × 40" : ""}`, async () => {
      await page.setInputFiles("#image-file", { name: `photo-${o}.jpg`, mimeType: "image/jpeg", buffer: exifJpeg(o) });
      await opened(o >= 5 ? `${H} × ${W} px` : `${W} × ${H} px`);
      await isUpright(o);
    });
  }
  for (let o = 1; o <= 8; o++) {
    await check(`a PNG with eXIf orientation ${o}, dropped, is shown upright`, async () => {
      // Open a plain one first, so the size text changes with the drop whatever o is.
      await page.setInputFiles("#image-file", { name: "reset.png", mimeType: "image/png", buffer: makePng(null, 8, 8) });
      await opened("8 × 8 px");
      assert.equal(await drop("#viewport", [{ name: `shot-${o}.png`, bytes: makePng(o) }]), "taken");
      await opened(o >= 5 ? `${H} × ${W} px` : `${W} × ${H} px`);
      await isUpright(o);
    });
  }

  await check("an image too big for the screen's graphics leaves the open image as it was, with the message", async () => {
    const max = await page.evaluate(() => document.createElement("canvas").getContext("webgl2")?.getParameter(0x0d33) ?? null); // MAX_TEXTURE_SIZE
    if (!(max < 16384)) return console.log(`  (skipped: this browser's graphics hold ${max} pixels along a side, the most an image may have)`);
    await page.setInputFiles("#image-file", { name: "photo.png", mimeType: "image/png", buffer: makePng(6) });
    await opened(`${H} × ${W} px`);
    await page.setInputFiles("#image-file", { name: "wide.png", mimeType: "image/png", buffer: makePng(null, 16384, 1, () => [128, 128, 128]) });
    await page.waitForFunction(() => document.querySelector("#image-error")?.textContent !== "");
    assert.match(await page.textContent("#image-error"), /this screen's graphics can show at most \d+ pixels along a side/);
    await isUprightKept();
  });
  async function isUprightKept() {
    assert.equal(await page.textContent("#image-pixels"), `${H} × ${W} px`, "the open image's size is still shown");
    assert.equal(await page.textContent("#layer-list [data-node]"), "Layer 1");
    const { colours } = await quartersOnScreen();
    colours.forEach((c, i) => near(c, UPRIGHT[6][i], `the kept image, quarter ${i + 1}`));
  }

  await check("a project whose formatVersion comes after its first 64 KB opens", async () => {
    const saved = JSON.parse(readFileSync(new URL("./saved.spindle", import.meta.url), "utf8"));
    const late = Buffer.from(JSON.stringify({ aNote: "x".repeat(70000), ...saved }));
    assert.ok(late.indexOf('"formatVersion"') > 65536);
    await page.evaluate(() => (document.querySelector("#file-status").textContent = "?"));
    assert.equal(await drop("#viewport", [{ name: "late.spindle", bytes: late }]), "taken");
    await page.waitForFunction(() => document.querySelector("#file-status").textContent !== "?", null, { timeout: 15000 });
    assert.equal(await page.textContent("#file-status"), "", "opened: no refusal (it was refused as renamed)");
  });

  if (browserName === "chromium") {
    await check("a dropped folder says it is a folder", async () => {
      const dir = mkdtempSync(join(tmpdir(), "files-hunt-"));
      const folder = join(dir, "Holiday photos");
      mkdirSync(folder);
      const cdp = await page.context().newCDPSession(page);
      await page.evaluate(() => (document.querySelector("#file-status").textContent = "?"));
      const data = { items: [], files: [folder], dragOperationsMask: 1 };
      for (const type of ["dragEnter", "dragOver", "drop"]) await cdp.send("Input.dispatchDragEvent", { type, x: 500, y: 300, data });
      await page.waitForFunction(() => document.querySelector("#file-status").textContent !== "?", null, { timeout: 5000 });
      assert.equal(await page.textContent("#file-status"), "Couldn't open “Holiday photos”: it is a folder. Drop or paste one file from inside it.");
    });
  }

  await check("Download STL's note names the file typed in the name box", async () => {
    const p = await browser.newPage({ viewport: { width: 1000, height: 640 }, acceptDownloads: true });
    // The name box, as in a browser with no save picker driven by a person (not a test).
    await p.addInitScript(() => {
      indexedDB.deleteDatabase("fission");
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
      window.showSaveFilePicker = undefined;
    });
    await p.goto(url);
    await startWithBox(p);
    await p.click("#toolbar [data-op=export_stl]");
    await p.waitForSelector("#save-name-input");
    await p.fill("#save-name-input", "bracket-v2");
    const [d] = await Promise.all([p.waitForEvent("download"), p.click(".save-name .ok")]);
    assert.equal(d.suggestedFilename(), "bracket-v2.stl");
    await p.waitForFunction(() => /Exported/.test(document.querySelector("#action-note")?.textContent ?? ""));
    assert.match(await p.textContent("#action-note"), /^Exported bracket-v2\.stl\./);
    await p.close();
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) process.exit(1);
