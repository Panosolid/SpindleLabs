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
// Chromium only (the DevTools protocol).
// Run with `node e2e/closed-views.mjs` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch, untilBodies } from "./browser.mjs";
import { insertPreset, switchTo } from "./start.mjs";

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
  // The box fills the middle of the home view; the background is #14161a.
  const middle = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas");
    const gl = canvas.getContext("webgl2");
    const px = new Uint8Array(4);
    gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [...px.slice(0, 3)];
  });
  assert.notDeepEqual(middle, [0x14, 0x16, 0x1a], "the main view still draws the box");
  assert.notDeepEqual(middle, [0, 0, 0], "the main view still draws the box");
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

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
process.exit(failed ? 1 : 0);
