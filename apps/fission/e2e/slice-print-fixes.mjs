// Browser checks of the Slice for printing fixes from the slicer hunt (2026-10-31), in a page that behaves like a
// phone, Firefox or Safari (navigator.webdriver false, no save picker, so the name box asks):
//  1. the name box opens ON TOP of the Slice dialog (it opened behind it, unreachable, and the dialog stuck on Slicing…);
//  2. the print preview gives its WebGL context back: 20 previews later the Design view still draws;
//  3. the preview shows the file that is downloaded (same time and filament as the download's words, not the plain file's);
//  4. closing the dialog mid-slice drops the file (nothing downloads); the dialog reopened says Slicing… and the buttons stay off;
//  5. a result is cleared when a choice changes; an engine refusal reads as advice;
//  6. closing the preview puts keyboard focus on File ▾;
//  7. at phone width the preview still says how long and how much plastic.
// At a desktop width with clicks and a phone's with taps. Run with `npm run e2e` (after `npm run build`); SHOTS=dir saves screenshots.
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

/** A page like a phone's browser: not driven (webdriver false), no save picker; contexts counted; slices can be held. */
async function fresh(width, tap) {
  const context = await browser.newContext({ viewport: { width, height: tap ? 667 : 800 }, hasTouch: tap, isMobile: tap, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("fission");
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    delete window.showSaveFilePicker;
    window.__ctx = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) {
      const c = get.call(this, t, ...r);
      if (c && /webgl/.test(t) && !window.__ctx.includes(c)) window.__ctx.push(c);
      return c;
    };
    // Hold the kernel's slice calls for window.kernelDelay ms.
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...rest) {
      const wait = window.kernelDelay ?? 0;
      if (wait > 0 && m && (m.op === "slice_stl" || m.op === "print_file_stl")) return void setTimeout(() => send.call(this, m, ...rest), wait);
      return send.call(this, m, ...rest);
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page, tap);
  return page;
}
const open = async (page, tap) => {
  await chooseFile(page, "file-slice-print", tap);
  await page.waitForSelector("#slice-print-dialog[open]");
};

for (const [width, tap] of [[1280, false], [375, true]]) {
  const at = `${width} px${tap ? ", taps" : ""}`;
  await check(`${at}: the name box is on top of the Slice dialog and saves under the name typed`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      press("#slice-print-go");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      const top = await page.evaluate(() => {
        const r = document.querySelector(".save-name input").getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ok = document.querySelector(".save-name .ok").getBoundingClientRect();
        const hitOk = document.elementFromPoint(ok.x + ok.width / 2, ok.y + ok.height / 2);
        return { input: hit?.closest(".save-name") !== null, ok: hitOk?.closest(".save-name") !== null };
      });
      assert.deepEqual(top, { input: true, ok: true }, "the box, not the dialog, is under the finger");
      if (shots) await page.screenshot({ path: `${shots}/slice-print-fixes-${width}-name-box.png` });
      await page.fill(".save-name input", "My box");
      const [download] = await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      assert.equal(download.suggestedFilename(), "My box.gcode.3mf");
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved My box.gcode.3mf"));
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: the preview shows the file that is downloaded (the same time and plastic), and a closed preview gives its WebGL context back`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      await open(page, tap);
      press("#slice-print-go");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      const saved = await page.textContent("#slice-print-status");
      const words = (s) => s.match(/(\d+ layers?, .*?filament\), about .*? of printing)/)?.[1];
      assert.ok(words(saved), saved);
      await press("#slice-print-preview");
      await page.waitForSelector("#print-preview[open]", { timeout: 60000 });
      const shown = await page.textContent("#print-preview-words");
      assert.equal(words(shown), words(saved), "the preview says what the saved file says");
      assert.equal(await page.$eval("#print-preview-words", (e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0), true, "and shows it, at any width");
      assert.match(await page.textContent("#print-preview-legend"), /Support \(none\)/);
      if (shots) await page.screenshot({ path: `${shots}/slice-print-fixes-${width}-preview.png` });
      // 20 previews: before the fix Chrome dropped the oldest WebGL context at the 17th, the Design view's.
      for (let i = 0; i < 20; i++) {
        await page.click("#print-preview-close");
        await page.waitForSelector("#print-preview", { state: "detached" });
        await open(page, tap);
        await press("#slice-print-preview");
        await page.waitForSelector("#print-preview[open]", { timeout: 60000 });
      }
      await page.click("#print-preview-close");
      await page.waitForSelector("#print-preview", { state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "file-menu", "focus goes to File ▾, where Slice for printing is");
      const lost = await page.evaluate(() => {
        const c = document.querySelector("#viewport canvas");
        const x = window.__ctx.find((k) => k.canvas === c);
        return { tracked: !!x, mainLost: x ? x.isContextLost() : null, live: window.__ctx.filter((k) => !k.isContextLost()).length };
      });
      assert.equal(lost.tracked, true);
      assert.equal(lost.mainLost, false, "the Design view still draws");
      assert.ok(lost.live <= 4, `the previews' contexts were let go: ${lost.live} live`);
    } finally {
      await page.context().close();
    }
  });

  await check(`${at}: closing the dialog mid-slice drops the file; reopened it says Slicing… with its buttons off; a changed choice clears a result`, async () => {
    const page = await fresh(width, tap);
    const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
    try {
      const downloads = [];
      page.on("download", (d) => downloads.push(d.suggestedFilename()));
      await open(page, tap);
      await page.evaluate(() => (window.kernelDelay = 2500));
      await press("#slice-print-go");
      assert.equal(await page.$eval("#slice-print-preview", (b) => b.disabled), true, "Preview is off while Slice and download runs");
      await press("#slice-print-close");
      await open(page, tap);
      assert.equal(await page.textContent("#slice-print-status"), "Slicing…");
      assert.equal(await page.$eval("#slice-print-go", (b) => b.disabled), true);
      await page.waitForFunction(() => !document.getElementById("slice-print-go").disabled, null, { timeout: 30000 });
      await page.waitForTimeout(500);
      assert.equal(await page.$(".save-name"), null, "no name box for a dropped slice");
      assert.deepEqual(downloads, [], "nothing downloaded");
      assert.equal(await page.textContent("#slice-print-status"), "");
      // A result, then a changed choice.
      await page.evaluate(() => (window.kernelDelay = 0));
      press("#slice-print-go");
      await page.waitForSelector(".save-name input", { timeout: 60000 });
      await Promise.all([page.waitForEvent("download"), press(".save-name .ok")]);
      await page.waitForFunction(() => document.getElementById("slice-print-status")?.textContent.startsWith("Saved"));
      await page.selectOption("#slice-print-infill", "25");
      assert.equal(await page.textContent("#slice-print-status"), "", "the old result is gone");
    } finally {
      await page.context().close();
    }
  });
}

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
await browser.close();
server.httpServer.close();
if (failed || errors.length) process.exit(1);
