// Split view opened and closed many times (found by the soak test, soak.mjs):
// each closed split view must be let go. Before the fix every closed view
// stayed alive with its WebGL context, so about the 16th open made Chromium
// drop its oldest context, the main view's, and the 3D view went blank.
// Checks, after 20 opens and closes at 1280 px: the main view's context is
// not lost and still draws the box (a pixel probe at its middle is not the
// background), no "Too many active WebGL contexts" warning, and no closed
// view's elements left in memory (DevTools' detached nodes after a forced
// collection). Chromium only (the DevTools protocol).
// Run with `node e2e/split-contexts.mjs` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch, untilBodies } from "./browser.mjs";
import { insertPreset } from "./start.mjs";

const TOGGLES = 20;
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: "error" });
const browser = await launch();
const warnings = [];
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("console", (m) => /WebGL context|Context Lost/i.test(m.text()) && warnings.push(m.text()));
  await page.goto("http://localhost:4185/?test-hooks");
  await page.waitForSelector("#start-hint", { state: "visible" });
  await insertPreset(page, "box");
  await untilBodies(page, 1);
  await page.evaluate(() => document.querySelector("#viewport canvas").addEventListener("webglcontextlost", () => (window.mainLost = true)));
  for (let i = 0; i < TOGGLES; i++) {
    await page.click("#split-toggle");
    await page.waitForFunction(() => document.body.dataset.split);
    await page.click("#split-close");
    await page.waitForFunction(() => !document.body.dataset.split);
  }
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
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("DOM.enable");
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  const views = detachedNodes.filter((d) => /view-controls|view-cube/.test(JSON.stringify(d.treeNode.attributes ?? [])) || JSON.stringify(d.treeNode.attributes ?? []).includes("three.js"));
  assert.equal(views.length, 0, `closed split views let go (${views.length} of their elements still held)`);
  console.log(`PASS split view opened and closed ${TOGGLES} times: the main view keeps drawing, no closed view held`);
} catch (e) {
  failed = true;
  console.log(`FAIL split view opened and closed ${TOGGLES} times\n  ${e.message.split("\n").join("\n  ")}`);
}
await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
process.exit(failed ? 1 : 0);
