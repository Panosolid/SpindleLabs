// 3D views that close must be let go (found by the soak test, soak.mjs, and
// the leak hunt after it). Before the fixes every closed split view stayed
// alive with its WebGL context, so about the 16th open made Chromium drop
// its oldest context, the main view's, and the 3D view went blank; a split
// view that drew the design, and every guide closed, stayed in memory too
// (three.js keeps a listener for each renderer on whatever it drew, shared
// with the main view, and on its one lookup texture for lit materials).
// Three checks at 1280 px, each opening and closing 20 times: split view
// beside Design (Image in it), split view showing Design (Render in the
// main pane), and the guide. After each: the main view keeps its WebGL
// context and draws the box (a pixel probe at its middle), no "Too many
// active WebGL contexts" warning, and no closed view's or guide's elements
// left in memory (DevTools' detached nodes after a forced collection).
// Then panels that close (found by the soak at phone width): each of the
// Sketch, Extrude and Edit feature panels emptied itself after hiding, so a
// button under the pointer as it was pressed (Extrude, OK) was taken out of
// a panel no longer drawn, and Chromium kept that panel marked "under the
// pointer" for good: once the pointer moved on (the toolbar's STL), File ▾ >
// Open's fresh panels left the old ones in memory, one of each for every
// design opened, with all they held. A panel now empties itself while still
// drawn, then hides. At 375 and 1280 px, ROUNDS times: a rectangle sketched
// and extruded, its distance changed in Edit feature, the STL exported, the
// project saved, opened again, then emptied by New. No more of those panels
// may be held after the last round than after the second: the page's own
// last panels may be, not one more for every round (before: 3, 5, 7… at
// 375 px).
// Chromium only (the DevTools protocol).
// Run with `node e2e/closed-views.mjs` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch, untilBodies } from "./browser.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clickPlane, EMPTY_TOP } from "./sketch-screen.mjs";
import { chooseFile, closePanels, gridSnapOn, insertPreset, openPanel, sheetsClearFor, switchTo } from "./start.mjs";

const TIMES = 20;
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: "error" });
const browser = await launch();
let failed = false;

/** A fresh page with the box, the main view's context watched. */
async function boxPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const warnings = [];
  page.on("console", (m) => /WebGL context|Context Lost/i.test(m.text()) && warnings.push(m.text()));
  await page.goto("http://localhost:4185/?test-hooks");
  await page.waitForSelector("#start-hint", { state: "visible" });
  await insertPreset(page, "box");
  await untilBodies(page, 1);
  await page.evaluate(() => document.querySelector("#viewport canvas").addEventListener("webglcontextlost", () => (window.mainLost = true)));
  return { page, warnings };
}

/** The main view still draws and nothing closed is held. */
async function judge({ page, warnings }) {
  await page.waitForTimeout(500);
  assert.deepEqual(warnings, [], "no WebGL context dropped or lost");
  assert.equal(await page.evaluate(() => Boolean(window.mainLost)), false, "the main view keeps its WebGL context");
  // The box fills the middle of the home view; the backdrop a dark blue gradient (backdrop.ts).
  const middle = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas");
    const gl = canvas.getContext("webgl2");
    const px = new Uint8Array(4);
    gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [...px.slice(0, 3)];
  });
  // The lit box is far brighter than the backdrop (a dark blue, every channel under 60, backdrop.ts) and than black.
  assert.ok(middle[0] + middle[1] + middle[2] > 3 * 80, `the main view still draws the box, got ${middle}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("DOM.enable");
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  const held = detachedNodes.filter((d) => /view-controls|view-cube|three\.js|guide/.test(JSON.stringify(d.treeNode.attributes ?? [])));
  assert.equal(held.length, 0, `closed views let go (${held.length} of their elements still held)`);
}

async function check(name, open, close, before = async () => {}, after = async () => {}) {
  const at = await boxPage();
  try {
    await before(at.page);
    for (let i = 0; i < TIMES; i++) {
      await open(at.page);
      await close(at.page);
    }
    await after(at.page);
    await judge(at);
    console.log(`PASS ${name} opened and closed ${TIMES} times: the main view keeps drawing, nothing closed is held`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name} opened and closed ${TIMES} times\n  ${e.message.split("\n").join("\n  ")}`);
  } finally {
    await at.page.context().close();
  }
}

const closeSplit = async (page) => {
  await page.click("#split-close");
  await page.waitForFunction(() => !document.body.dataset.split);
};
await check("split view beside Design (Image in it)", async (page) => {
  await page.click("#split-toggle");
  await page.waitForFunction(() => !!document.body.dataset.split);
}, closeSplit);
await check(
  "split view showing Design (Render in the main pane)",
  async (page) => {
    await page.click("#split-toggle");
    await page.waitForFunction(() => !!document.body.dataset.split);
    if ((await page.evaluate(() => document.body.dataset.split)) !== "design") await page.selectOption("#split-choice", "design");
    await page.waitForFunction(() => document.body.dataset.split === "design");
    await page.waitForTimeout(200); // let it draw the design
  },
  closeSplit,
  (page) => switchTo(page, "render"),
  async (page) => {
    await switchTo(page, "design");
    await page.waitForTimeout(300);
  },
);
await check("the guide", async (page) => {
  await page.click("#guide-open");
  await page.waitForFunction(() => !!document.querySelector("dialog.guide[open]"));
  await page.waitForTimeout(300); // let its scene draw
}, async (page) => {
  await page.click(".guide-close");
  await page.waitForFunction(() => !document.querySelector("dialog.guide"));
});

const ROUNDS = 6;
const PANELS = /id (sketch-panel|extrude-panel|feature-edit)\b/;
const file = join(tmpdir(), `closed-panels-${process.pid}.spindle`);

/** How many Sketch, Extrude and Edit feature panels are held out of the page. */
async function held(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  return detachedNodes.filter((d) => PANELS.test((d.treeNode.attributes ?? []).join(" "))).length;
}

/** One round, from an empty design back to one. */
async function round(page, first) {
  const until = (fn, arg) => page.waitForFunction(fn, arg);
  const bodyRows = (n) => until((k) => document.querySelectorAll('#browser [data-node^="body-"]').length === k, n);
  await page.click("#create-sketch");
  await page.click("#sketch-plane-XY");
  await until(() => document.querySelector("#viewport").dataset.sketching === "true");
  if (first) await gridSnapOn(page);
  await closePanels(page);
  await page.click("#sketch-tool-rectangle");
  for (const corner of [[0, 0], [20, 10]]) await clickPlane(page, corner, EMPTY_TOP);
  await until(() => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.");
  await page.click("#sketch-extrude");
  await until(() => document.querySelector("#extrude-status")?.textContent.startsWith("Sketch 1 makes a closed outline."));
  await page.fill("#extrude-distance", "5");
  await page.click("#extrude-ok");
  await bodyRows(1);
  // Edit feature from the Extrude's row menu: 5 mm becomes 7.
  await closePanels(page);
  const item = page.locator("#timeline [data-item]").last();
  await item.click({ button: "right" });
  await until(() => document.getElementById("row-menu").open);
  await page.click("#row-menu-edit");
  await until(() => document.getElementById("feature-edit")?.hidden === false);
  await openPanel(page, "properties");
  await page.fill("#feature-edit input[type=number]", "7");
  await page.click("#feature-edit-ok");
  await until(() => document.querySelector("#intent")?.textContent === "Extrude Sketch 1 by 7 mm");
  // The pointer moves on to the toolbar's STL, then the project is saved, opened again and emptied.
  await closePanels(page);
  await Promise.all([page.waitForEvent("download"), page.click("#toolbar [data-op=export_stl]")]);
  await until(() => document.querySelector("#save-status")?.dataset.state === "saved");
  const [download] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-save")]);
  await download.saveAs(file);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), chooseFile(page, "open")]);
  await chooser.setFiles(file);
  await bodyRows(1);
  await until(() => document.getElementById("viewport")?.dataset.rebuilding !== "true");
  await chooseFile(page, "start-fresh");
  await page.click("#start-fresh-confirm");
  await until(() => document.querySelector("#viewport").dataset.shape === "none");
  await untilBodies(page, 0);
}

for (const width of [375, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 667 }, acceptDownloads: true });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    await page.goto("http://localhost:4185/?test-hooks");
    await page.waitForSelector("#start-hint", { state: "visible" });
    sheetsClearFor(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    const counts = [];
    for (let i = 1; i <= ROUNDS; i++) {
      await round(page, i === 1);
      counts.push(await held(cdp));
    }
    // Held after each round, worked from the cause: the last round's panels at most, the same number every round.
    assert.ok(counts.at(-1) <= counts[1], `no more panels held after round ${ROUNDS} than after round 2 (held after each round: ${counts.join(", ")})`);
    console.log(`PASS panels at ${width} px: ${ROUNDS} designs sketched, extruded, edited, exported, saved, opened and emptied; panels held after each: ${counts.join(", ")}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL panels at ${width} px\n  ${e.message.split("\n").join("\n  ")}`);
  } finally {
    await context.close();
  }
}

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
process.exit(failed ? 1 : 0);
