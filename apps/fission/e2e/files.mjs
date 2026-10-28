// Browser check of files from outside (X6): a file dropped on the app or
// pasted goes through the representation registry. A project opens as
// Open does, a PNG opens in Image (in the split pane when Image is there),
// and every other file is refused in the top bar with what will take it;
// several at once, a renamed file and an unknown one each say so. Dragging
// files over the app outlines it; a paste into a text field is left alone;
// the browser never navigates to a dropped file. The top bar's Open routes
// a chosen file the same way.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { startWithBox, switchTo } from "./start.mjs";

/** A 200 × 100 RGBA PNG at 10000 px/m (254 DPI, 0.1 mm per pixel), all mid grey. */
function plate() {
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, data) => {
    const body = Buffer.from([...Buffer.from(type, "ascii"), ...data]);
    return Buffer.from([...be32(data.length), ...body, ...be32(crc32(body))]);
  };
  const rows = [];
  for (let y = 0; y < 100; y++) {
    rows.push(0);
    for (let x = 0; x < 200; x++) rows.push(128, 128, 128, 255);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", [...be32(200), ...be32(100), 8, 6, 0, 0, 0]),
    chunk("pHYs", [...be32(10000), ...be32(10000), 1]),
    chunk("IDAT", [...deflateSync(Buffer.from(rows))]),
    chunk("IEND", []),
  ]);
}
const png = plate();

const server = await preview({ preview: { port: 4176, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4176/";
const browser = await launch();
const errors = [];

async function fresh(width = 1000) {
  const page = await browser.newPage({ viewport: { width, height: 640 }, acceptDownloads: true });
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page); // a new project starts empty (U0c): the 40 × 30 × 20 box, inserted
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  return page;
}

/** Fires a drag of `files` ({ name, bytes }) over `selector` and drops it there, as a desktop drag would. */
const drop = (page, selector, files, { release = true } = {}) =>
  page.evaluate(
    ([selector, files, release]) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name));
      const el = document.querySelector(selector);
      const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(over);
      if (!over.defaultPrevented) return "dragover not taken";
      if (!release) return "held";
      const d = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(d);
      return d.defaultPrevented ? "taken" : "drop not taken";
    },
    [selector, files.map((f) => ({ name: f.name, bytes: [...f.bytes] })), release],
  );

/** Pastes `files` with `selector` focused, as Ctrl+V with files on the clipboard would. */
const paste = (page, selector, files) =>
  page.evaluate(
    ([selector, files]) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name));
      const el = document.querySelector(selector);
      el.focus();
      const e = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    [selector, files.map((f) => ({ name: f.name, bytes: [...f.bytes] }))],
  );

/** Answers the shell's "Open in Image?" (asked when a file belongs to a workspace not on screen): its confirm, or Cancel. */
async function answer(page, yes, tap = false) {
  await page.waitForSelector("#open-elsewhere", { state: "visible" });
  const sel = yes ? "#open-elsewhere-confirm" : "#open-elsewhere-cancel";
  await (tap ? page.tap(sel) : page.click(sel));
  await page.waitForSelector("#open-elsewhere", { state: "hidden" });
}

const status = (page) => page.textContent("#file-status");
const waitStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#file-status").textContent), re.source);
const bytes = (s) => Buffer.from(s, "latin1");

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

try {
  await check("refused files say who will take them, in the top bar, and Design stays as it was", async () => {
    const page = await fresh();
    try {
      const cases = [
        ["part.stl", "solid cube\n", "Couldn't open “part.stl”: SpindleLabs can't open STL meshes yet. Design will take them as mesh bodies."],
        ["logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', "Couldn't open “logo.svg”: SpindleLabs can't open SVG drawings yet. Vector and Laser will take them as outlines."],
        ["plate.dxf", "  0\nSECTION\n", "Couldn't open “plate.dxf”: SpindleLabs can't open DXF drawings yet. Laser will take them as outlines."],
        ["bracket.step", "ISO-10303-21;\n", "Couldn't open “bracket.step”: SpindleLabs can't open STEP models yet. Design will take them as exact solids."],
        ["poster.pdf", "%PDF-1.7\n", "Couldn't open “poster.pdf”: SpindleLabs can't open PDF documents yet. Layout will take them as pages."],
        ["notes.docx", "PK\x03\x04", "Couldn't open “notes.docx”: SpindleLabs doesn't know this type of file. It opens SpindleLabs projects (.spindlelabs.json), PNG images and JPEG images."],
        ["photo.png", "GIF89a", "Couldn't open “photo.png”: it is named like a PNG image, but its contents aren't one (it may be damaged, or renamed from another type)."],
      ];
      for (const [name, content, message] of cases) {
        assert.equal(await drop(page, "#viewport", [{ name, bytes: bytes(content) }]), "taken", name);
        await page.waitForFunction((m) => document.querySelector("#file-status").textContent === m, message);
        assert.equal(await page.isVisible("#file-dismiss"), true);
      }
      await page.screenshot({ path: "e2e/files-refused.png" });
      // Two at once: one at a time, and neither opens.
      await drop(page, "#properties", [{ name: "a.png", bytes: png }, { name: "b.png", bytes: png }]);
      await waitStatus(page, /^Drop or paste one file at a time \(there were 2\)\.$/);
      assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
      assert.equal(await page.textContent("#volume"), "24,000 mm³");
      assert.equal(page.url(), url + "#design", "the browser navigated to a dropped file");
      await page.click("#file-dismiss");
      assert.equal(await status(page), "");
    } finally {
      await page.close();
    }
  });

  await check("dragging files over the app outlines it; leaving the window takes the outline away", async () => {
    const page = await fresh();
    try {
      assert.equal(await drop(page, "#browser", [{ name: "a.png", bytes: png }], { release: false }), "held");
      assert.equal(await page.evaluate(() => document.body.dataset.drop), "on");
      const outline = await page.$eval("#workspace", (el) => getComputedStyle(el).outlineStyle);
      assert.equal(outline, "dashed");
      await page.screenshot({ path: "e2e/files-dragging.png" });
      await page.evaluate(() => window.dispatchEvent(new DragEvent("dragleave", { bubbles: true, relatedTarget: null })));
      assert.equal(await page.evaluate(() => document.body.dataset.drop), "");
      assert.equal(await page.$eval("#workspace", (el) => getComputedStyle(el).outlineStyle), "none");
      // A drag of text, not files, is the browser's own business: no outline, no drop taken.
      const text = await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "hello");
        const e = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
        document.querySelector("#viewport").dispatchEvent(e);
        return [e.defaultPrevented, document.body.dataset.drop];
      });
      assert.deepEqual(text, [false, ""]);
    } finally {
      await page.close();
    }
  });

  await check("a dropped PNG opens in Image at its real size; a pasted one too; a paste into a field is left alone", async () => {
    const page = await fresh();
    try {
      assert.equal(await drop(page, "#viewport", [{ name: "plate.png", bytes: png }]), "taken");
      await answer(page, true);
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
      // 200 × 100 px at 0.1 mm per pixel: 20 × 10 mm.
      await page.waitForFunction(() => document.querySelector("#image-mm")?.textContent === "20 × 10 mm");
      assert.equal(await status(page), "");
      await page.screenshot({ path: "e2e/files-dropped-png.png" });
      // Back in Design, a paste into the width field does nothing but paste.
      await switchTo(page, "design");
      await page.waitForSelector("#width");
      assert.equal(await paste(page, "#width", [{ name: "plate.png", bytes: png }]), false);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
      // The same paste with nothing focused opens it.
      assert.equal(await paste(page, "body", [{ name: "pasted.png", bytes: png }]), true);
      await answer(page, true);
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
      await page.waitForFunction(() => document.querySelector("#layer-list")?.textContent.includes("Layer 1"));
      // A refused paste says why, like a refused drop.
      assert.equal(await paste(page, "body", [{ name: "part.stl", bytes: bytes("solid x\n") }]), true);
      await waitStatus(page, /^Couldn't open “part\.stl”: SpindleLabs can't open STL meshes yet\./);
      assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "image");
    } finally {
      await page.close();
    }
  });

  await check("with Image in the split pane, a dropped PNG opens there and Design keeps the main pane", async () => {
    const page = await fresh(1280);
    try {
      await page.click("#split-toggle");
      await page.waitForSelector("#split-choice");
      await page.selectOption("#split-choice", "image");
      await page.waitForSelector("#split-toolbar #image-open");
      await drop(page, "#viewport", [{ name: "plate.png", bytes: png }]);
      await page.waitForFunction(() => document.querySelector("#split-properties #image-mm")?.textContent === "20 × 10 mm");
      assert.equal(await page.isVisible("#open-elsewhere"), false, "Image is on screen already: nothing to ask");
      assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
      assert.equal(await page.evaluate(() => document.body.dataset.split), "image");
    } finally {
      await page.close();
    }
  });

  await check("a dropped project opens as Open does; a broken one is refused and the open part stays", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³"); // 50 · 30 · 20
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const saved = await download.path().then((p) => import("node:fs").then((fs) => fs.readFileSync(p)));
      await page.fill("#width", "40");
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
      await drop(page, "#viewport", [{ name: "Untitled.fission.json", bytes: saved }]);
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³");
      assert.equal(await page.inputValue("#width"), "50");
      assert.equal(await status(page), "");
      // Cut short: it starts like a project, so it is routed as one, and the reader's own message says what is wrong.
      await drop(page, "#viewport", [{ name: "half.fission.json", bytes: bytes('{"formatVersion": 2, "name": "Cut') }]);
      await waitStatus(page, /^Couldn't open “half\.fission\.json”: not a SpindleLabs project: the file is not valid JSON/);
      assert.equal(await page.textContent("#volume"), "30,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("the top-bar Open takes what a drop takes: a PNG opens in Image, a project opens, an STL is refused the same way", async () => {
    const page = await fresh();
    try {
      await page.setInputFiles("#open-file", { name: "logo.png", mimeType: "image/png", buffer: png });
      await answer(page, true);
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image" || document.querySelector("#file-status").textContent !== "");
      assert.equal(await status(page), "");
      assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "image");
      // 200 × 100 px at 0.1 mm per pixel: 20 × 10 mm.
      await page.waitForFunction(() => document.querySelector("#image-mm")?.textContent === "20 × 10 mm");
      assert.equal(await status(page), "");
      await page.screenshot({ path: "e2e/files-open-png.png" });
      // A project still opens as a project.
      await switchTo(page, "design");
      await page.waitForSelector("#width");
      await page.fill("#width", "50");
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³"); // 50 · 30 · 20
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const saved = await download.path().then((p) => import("node:fs").then((fs) => fs.readFileSync(p)));
      await page.fill("#width", "40");
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
      await page.setInputFiles("#open-file", { name: "Untitled.fission.json", mimeType: "application/json", buffer: saved });
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³");
      // Refused through Open with the same words as a refused drop.
      await page.setInputFiles("#open-file", { name: "part.stl", mimeType: "model/stl", buffer: bytes("solid cube\n") });
      await waitStatus(page, /^Couldn't open “part\.stl”: SpindleLabs can't open STL meshes yet\. Design will take them as mesh bodies\.$/);
      assert.equal(await page.textContent("#volume"), "30,000 mm³");
      // The picker offers images as well as projects.
      const accept = (await page.getAttribute("#open-file", "accept")).split(",");
      for (const ext of [".json", ".png", ".jpg", ".jpeg"]) assert.ok(accept.includes(ext), `Open's picker accepts ${accept}, not ${ext}`);
    } finally {
      await page.close();
    }
  });

  // The owner's report (2026-10-28): File ▾ > Open in an empty Design with an image switched to Image without asking, and
  // Design's "Start your design" card stayed floating over the image. Now the shell asks first, Cancel changes nothing,
  // and the card shows only while Design is on screen.
  for (const [width, tap] of [[1280, false], [393, true]])
    await check(`Open… with an image in an empty Design asks "Open in Image?"; Cancel stays; Open in Image leaves no Design card over it (${width} px${tap ? ", taps" : ""})`, async () => {
      const context = await browser.newContext({ viewport: { width, height: tap ? 852 : 800 }, hasTouch: tap });
      const page = await context.newPage();
      await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(url + "#design");
        await page.waitForSelector("#start-hint", { state: "visible" });
        const open = () => page.setInputFiles("#open-file", { name: "car.png", mimeType: "image/png", buffer: png });
        await open();
        await page.waitForSelector("#open-elsewhere", { state: "visible" });
        assert.equal(await page.textContent("#open-elsewhere-heading"), "Open in Image?");
        assert.equal(await page.textContent("#open-elsewhere-words"), "“car.png” is a PNG image, which opens in the Image workspace. Design stays as it is, and the workspace menu at the top takes you back.");
        assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design", "nothing switches before the answer");
        // The question is a small box, never most of the view (the owner's phone rule), and fits the width.
        const box = await page.$eval("#open-elsewhere", (d) => d.getBoundingClientRect().toJSON());
        assert.ok(box.left >= 0 && box.right <= width, `the question fits the width: ${box.left}..${box.right}`);
        assert.ok(box.width * box.height < 0.3 * width * (tap ? 852 : 800), `the question covers ${Math.round((100 * box.width * box.height) / (width * (tap ? 852 : 800)))}% of the screen`);
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/open-in-image-ask-${width}.png` });
        // Cancel: still Design, its card still there, nothing opened, nothing said.
        await answer(page, false, tap);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
        assert.equal(await page.isVisible("#start-hint"), true, "the card stays in Design");
        assert.equal(await status(page), "");
        // Escape answers no too (wide screen: a phone has no key).
        if (!tap) {
          await open();
          await page.waitForSelector("#open-elsewhere", { state: "visible" });
          await page.keyboard.press("Escape");
          await page.waitForSelector("#open-elsewhere", { state: "hidden" });
          assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
        }
        // Open in Image: the image, 200 × 100 px at 0.1 mm per pixel = 20 × 10 mm, and no Design card over it.
        await open();
        await answer(page, true, tap);
        await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
        await page.waitForFunction(() => document.querySelector("#image-mm")?.textContent === "20 × 10 mm");
        await page.waitForFunction(() => document.querySelector("#layer-list")?.textContent.includes("Layer 1"));
        assert.equal(await page.isVisible("#start-hint"), false, "Design's card must not float over Image");
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/open-in-image-opened-${width}.png` });
        // Back in Design, the design is still empty, so its card is back.
        await switchTo(page, "design", tap);
        await page.waitForFunction(() => document.body.dataset.activeWorkspace === "design");
        await page.waitForSelector("#start-hint", { state: "visible" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, "no sideways scroll");
      } finally {
        await context.close();
      }
    });

  await check("a dropped or pasted image in Design asks too, and Cancel opens nothing", async () => {
    const page = await fresh();
    try {
      for (const send of [() => drop(page, "#viewport", [{ name: "plate.png", bytes: png }]), () => paste(page, "body", [{ name: "plate.png", bytes: png }])]) {
        await send();
        await answer(page, false);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
        assert.equal(await status(page), "");
      }
      // Nothing reached Image: shown now, it has no layer.
      await switchTo(page, "image");
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.querySelector("#layer-list")?.textContent.includes("Layer 1") ?? false), false, "a cancelled image was opened anyway");
      // Image on screen: a dropped image opens there without a question.
      await drop(page, "#viewport", [{ name: "plate.png", bytes: png }]);
      await page.waitForFunction(() => document.querySelector("#image-mm")?.textContent === "20 × 10 mm");
      assert.equal(await page.isVisible("#open-elsewhere"), false);
    } finally {
      await page.close();
    }
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);
console.log("file checks passed");
