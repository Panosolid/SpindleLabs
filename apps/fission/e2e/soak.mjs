// The long-session soak test: one page driven through the same cycle again
// and again, as a person working for hours would (a sketch drawn and
// extruded, a box inserted and its width typed, Undo and Redo, split view
// opened and closed, the project saved and opened again, then New), with
// what the page holds read after every few cycles: the JavaScript heap
// after a forced garbage collection, DOM nodes, event listeners, the
// kernel's bodies and WebAssembly memory, and the viewport's geometries,
// textures, shader programs and scene objects (`?test-hooks`). Each cycle
// ends where the first one began (an empty design), so nothing should grow:
// `judgeSoak` (soak-judge.mjs) fails a reading that is still climbing once
// the warm-up is over.
// SOAK_CYCLES (default 40) sets the length, SOAK_EVERY how often it reads,
// SOAK_REPORT=<file> writes the readings as JSON. Chromium only (the heap
// and DOM counts come from the DevTools protocol).
// Run with `node e2e/soak.mjs` (after `npm run build`).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { preview } from "vite";
import { launch, untilBodies } from "./browser.mjs";
import { clickPlane, EMPTY_TOP } from "./sketch-screen.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, fileItem, gridSnapOn, insertPreset, pickPlane } from "./start.mjs";
import { judgeSoak } from "./soak-judge.mjs";

const CYCLES = Number(process.env.SOAK_CYCLES ?? 40);
const EVERY = Number(process.env.SOAK_EVERY ?? 5);

const server = await preview({ preview: { port: 4181, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await context.newPage();
await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  // A driver's performance note (a GPU stall on readPixels) is not a problem; a lost or refused WebGL context is.
  if (m.type() === "error" || (/WebGL|context/i.test(m.text()) && !/GL Driver Message .*Performance/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`);
});
await page.goto("http://localhost:4181/?test-hooks");
await page.waitForSelector("#start-hint", { state: "visible" });
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");

// Snap to grid lives in the sketch panel and lasts for the page: tick it in a sketch, then Undo that sketch.
await page.click("#create-sketch");
await pickPlane(page, "XY", false);
await gridSnapOn(page);
await page.keyboard.press("ControlOrMeta+z");
await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");

const volume = (text) => page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text);
const saveFile = join(tmpdir(), `soak-${process.pid}.spindlelabs.json`);

/** One cycle, from an empty design back to one. */
async function cycle(i) {
  // A sketch on the ground, a 40 × 30 rectangle, extruded 10: 12,000 mm³.
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
  await page.click("#sketch-tool-rectangle");
  for (const corner of [[0, 0], [40, 30]]) await clickPlane(page, corner, EMPTY_TOP);
  await page.waitForFunction(() => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.");
  await page.click("#sketch-extrude");
  await page.waitForFunction(() => document.querySelector("#extrude-status")?.textContent.startsWith("Sketch 1 makes a closed outline."));
  await page.click("#extrude-ok");
  await volume("12,000 mm³");

  // A box beside it, its width typed: a second body, then an edit.
  await insertPreset(page, "box");
  await untilBodies(page, 2);
  await pinProperties(page);
  await page.click("#width");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(String(41 + (i % 9)));
  await page.keyboard.press("Enter");
  await page.waitForFunction((w) => document.querySelector("#width")?.value === w, String(41 + (i % 9)));

  // Three undos and three redos.
  for (let k = 0; k < 3; k++) await page.click("#undo");
  for (let k = 0; k < 3; k++) await page.click("#redo");
  await untilBodies(page, 2);

  // Split view opened and closed.
  await page.click("#split-toggle");
  await page.waitForFunction(() => document.body.dataset.split);
  await page.click("#split-close");
  await page.waitForFunction(() => !document.body.dataset.split);

  // Saved, emptied by New, then opened again.
  await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  await download.saveAs(saveFile);
  await emptyDesign();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), chooseFile(page, "open")]);
  await chooser.setFiles(saveFile);
  await untilBodies(page, 2);
  await emptyDesign();
}

/** File ▾ > New, confirmed: the design empty and the kernel holding nothing. */
async function emptyDesign() {
  await chooseFile(page, "start-fresh");
  await page.click("#start-fresh-confirm");
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.shape === "none");
  await untilBodies(page, 0);
}

/** What the page holds now, after a forced garbage collection. */
async function reading(cycleNo) {
  await page.waitForTimeout(300); // let rebuilds and the autosave settle
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const hooks = await page.evaluate(async () => {
    const t = window.fissionTest;
    return { bodies: await t.bodyCount(), wasm: await t.wasmBytes(), ...t.gpu() };
  });
  return {
    cycle: cycleNo,
    heap: metrics.JSHeapUsedSize,
    nodes: metrics.Nodes,
    listeners: metrics.JSEventListeners,
    documents: metrics.Documents,
    ...hooks,
  };
}

const readings = [await reading(0)];
const t0 = Date.now();
let failure = null;
try {
  for (let i = 1; i <= CYCLES; i++) {
    await cycle(i);
    if (i % EVERY === 0 || i === CYCLES) {
      const r = await reading(i);
      readings.push(r);
      console.log(`cycle ${i}: heap ${(r.heap / 1e6).toFixed(2)} MB, nodes ${r.nodes}, listeners ${r.listeners}, bodies ${r.bodies}, wasm ${(r.wasm / 1e6).toFixed(1)} MB, geometries ${r.geometries}, textures ${r.textures}, programs ${r.programs}, objects ${r.objects}`);
    }
  }
} catch (e) {
  failure = e;
}
const seconds = (Date.now() - t0) / 1000;
await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));

if (process.env.SOAK_REPORT) {
  mkdirSync(dirname(process.env.SOAK_REPORT), { recursive: true });
  writeFileSync(process.env.SOAK_REPORT, JSON.stringify({ cycles: CYCLES, seconds, readings, errors }, null, 2));
}
if (failure) {
  console.log(`FAIL the soak's cycle stopped: ${failure.message.split("\n")[0]}`);
  process.exit(1);
}
const problems = [...judgeSoak(readings), ...errors.map((e) => `the page said: ${e}`)];
for (const p of problems) console.log(`FAIL ${p}`);
console.log(`${problems.length ? "FAIL" : "PASS"} soak: ${CYCLES} cycles in ${seconds.toFixed(0)} s`);
process.exit(problems.length ? 1 : 0);
