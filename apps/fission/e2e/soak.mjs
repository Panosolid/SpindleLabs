// The long-session soak test: one page used as a person working for hours
// would, cycle after cycle, each cycle's order and sizes chosen by the seed
// (SOAK_SEED, default 1; same seed and code, same run): a rectangle sketched
// and extruded, a box inserted and its width typed, the box lifted by Move,
// a few Undos and as many Redos, another workspace shown and Design again,
// split view opened and closed, all at a wide screen or a phone's width,
// then the project saved, emptied by New and opened again, and New once
// more. Two things are checked:
// - The design, every cycle (soak-model.mjs): the exported STL's triangles,
//   volume and height range, each body's volume in Properties and the
//   Browser's bodies match the model worked from the sizes the seed chose
//   (every body is a box); Redo after Undo gives back the same
//   design; the file opened again gives the same design; and every
//   SOAK_EVERY cycles a fresh page (a from-scratch rebuild) opens the file
//   and gets the same design, and saves the same file.
// - Memory, every SOAK_EVERY cycles: the JavaScript heap after a forced
//   garbage collection, DOM nodes (counted here, see domNodes), event
//   listeners, the kernel's bodies and
//   WebAssembly memory, and the viewport's geometries, textures, shader
//   programs and scene objects (`?test-hooks`). Each cycle ends where the
//   first began (an empty design, wide screen), so nothing should grow:
//   `judgeSoak` (soak-judge.mjs) fails a reading still climbing after the
//   warm-up. Before the first reading the page visits every workspace and
//   the phone width once, so first-visit caches count as warm-up.
// Each cycle prints what it did, so a failure says what led to it.
// SOAK_CYCLES (default 40) sets the length (the heap needs about 30 cycles
// to settle: shorter runs fail its verdict on the engine's warm-up), SOAK_EVERY (default 5) how often
// it reads, SOAK_SCREEN=wide or phone keeps every cycle at that size,
// SOAK_REPORT=<file> writes the readings as JSON, SOAK_DEBUG=1 prints which
// nodes changed between readings, SOAK_SHOT=<png> takes a screenshot when a
// cycle can't go on, SOAK_DIST serves another build than dist (the plants,
// soak-plants.mjs, build there) and SOAK_PORT its port. Chromium only (the
// heap and DOM counts come from the DevTools protocol).
// Run with `node e2e/soak.mjs` (after `npm run build`).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { preview } from "vite";
import { launch, untilBodies } from "./browser.mjs";
import { rng } from "./monkey-core.mjs";
import { clickPlane, EMPTY_TOP } from "./sketch-screen.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, closePanels, gridSnapOn, insertPreset, openPanel, pickPlane, sheetsClearFor, switchTo } from "./start.mjs";
import { judgeSoak, WARM_UP } from "./soak-judge.mjs";
import { expected, matchesModel, sameState, stlFacts } from "./soak-model.mjs";

const CYCLES = Number(process.env.SOAK_CYCLES ?? 40);
const EVERY = Number(process.env.SOAK_EVERY ?? 5);
const SEED = Number(process.env.SOAK_SEED ?? 1);
const PORT = Number(process.env.SOAK_PORT ?? 4181);
const URL = `http://localhost:${PORT}/?test-hooks`;
const WIDE = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 667 };
/** SOAK_SCREEN=wide or phone keeps every cycle at that size (to tell which one a problem needs); the seed still picks the rest. */
const SCREEN = { wide: WIDE, phone: PHONE }[process.env.SOAK_SCREEN] ?? null;
/** The workspaces a cycle may visit and come back from. */
const OTHERS = ["render", "simulate", "manufacture", "laser", "slice", "circuit", "vector", "image", "layout"];

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error", ...(process.env.SOAK_DIST ? { build: { outDir: process.env.SOAK_DIST } } : {}) });
const browser = await launch();
const errors = [];
const watch = (page, who) => {
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => {
    // A driver's performance note (a GPU stall on readPixels) is not a problem; a lost or refused WebGL context is.
    if (m.type() === "error" || (/WebGL|context/i.test(m.text()) && !/GL Driver Message .*Performance/.test(m.text()))) errors.push(`${who}: ${m.type()}: ${m.text()}`);
  });
};
/** A new page on the app, empty, its phone sheets put away before a press on what they cover (start.mjs). */
async function openApp(context, who) {
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  watch(page, who);
  await page.goto(URL);
  await page.waitForSelector("#start-hint", { state: "visible" });
  return sheetsClearFor(page);
}
const context = await browser.newContext({ viewport: WIDE, acceptDownloads: true });
const page = await openApp(context, "the page");
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");

const until = (p, fn, arg) => p.waitForFunction(fn, arg);
const saveFile = join(tmpdir(), `soak-${process.pid}.spindle`);
const resaved = join(tmpdir(), `soak-${process.pid}-fresh.spindle`);

/** A sketch on the ground plane: Create Sketch, then the XY plane (on a phone, from the bar over the view). */
async function sketchOnGround(p) {
  await p.click("#create-sketch");
  await pickPlane(p, "XY", false);
  await until(p, () => document.querySelector("#viewport").dataset.sketching === "true");
}

/** Body `n`'s row in the Browser pressed (on a phone, in its sheet). */
async function pickBody(p, n) {
  await openPanel(p, "browser");
  await p.click(`#browser [data-node="body-${n}"]`);
}

/** Every rebuild asked for has landed. */
const rebuilt = (p) => until(p, () => document.getElementById("viewport")?.dataset.rebuilding !== "true");

/** What the app holds now: the STL's facts, the timeline's titles, the Browser's bodies and how many shapes the kernel holds (with a Move, the box before it too). */
async function state(p) {
  await rebuilt(p);
  await closePanels(p);
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#toolbar [data-op=export_stl]")]);
  const stl = stlFacts(readFileSync(await download.path()));
  const items = await p.$$eval("#timeline [data-item]", (els) => els.map((e) => e.title));
  const bodies = await p.$$eval('#browser [data-node^="body-"]', (els) => els.length);
  const kernel = await p.evaluate(() => window.fissionTest.bodyCount());
  return { stl, items, bodies, kernel };
}

/** Saves the project to `file` with File ▾ > Save, once the autosave has caught up. */
async function save(p, file) {
  await until(p, () => document.querySelector("#save-status")?.dataset.state === "saved");
  const [download] = await Promise.all([p.waitForEvent("download"), chooseFile(p, "file-save")]);
  await download.saveAs(file);
}
/** The Browser lists `n` bodies. */
const untilShown = (p, n) => until(p, (k) => document.querySelectorAll('#browser [data-node^="body-"]').length === k, n);
/** Opens `file` with File ▾ > Open and waits for its `bodies` bodies. */
async function open(p, file, bodies) {
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), chooseFile(p, "open")]);
  await chooser.setFiles(file);
  await untilShown(p, bodies);
  await rebuilt(p);
}
/** File ▾ > New, confirmed: the design empty and the kernel holding nothing. */
async function emptyDesign(p) {
  await chooseFile(p, "start-fresh");
  await p.click("#start-fresh-confirm");
  await until(p, () => document.querySelector("#viewport").dataset.shape === "none");
  await untilBodies(p, 0);
}

let problems = [];
const fail = (cycleNo, list) => list.length && problems.push(...list.map((x) => `cycle ${cycleNo}: ${x}`));

/** Another workspace shown, then Design again. */
async function visit(id) {
  await switchTo(page, id);
  await until(page, (w) => document.body.dataset.activeWorkspace === w, id);
  await switchTo(page, "design");
  await until(page, () => document.body.dataset.activeWorkspace === "design");
}

/** One cycle, from an empty design back to one; `random` the seeded generator. Throws when the app can't be driven; design mismatches go to `problems`. */
async function cycle(i, random) {
  const between = (lo, hi, step = 1) => lo + step * Math.floor(random() * ((hi - lo) / step + 1));
  // Cycle 1 is at a wide screen and cycle 2 at a phone's width, both doing everything, so the warm-up has seen it all.
  const pick = i === 1 ? WIDE : i === 2 ? PHONE : random() < 0.4 ? PHONE : WIDE;
  const screen = SCREEN ?? pick;
  await page.setViewportSize(screen);
  const at = screen === PHONE ? "phone" : "wide";
  const did = [at];
  const bodies = [];
  let items = 0;

  // A w × d rectangle on the ground (grid snap, at the empty sketch's zoom on 10 mm marks), extruded h.
  const [w, d, h] = [between(10, 40, 10), between(10, 30, 10), between(4, 18)];
  await sketchOnGround(page);
  await page.click("#sketch-tool-rectangle");
  for (const corner of [[0, 0], [w, d]]) await clickPlane(page, corner, EMPTY_TOP);
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.");
  await page.click("#sketch-extrude");
  await until(page, () => document.querySelector("#extrude-status")?.textContent.startsWith("Sketch 1 makes a closed outline."));
  await page.fill("#extrude-distance", String(h));
  await page.click("#extrude-ok");
  await untilShown(page, 1);
  bodies.push({ w, d, h, z: 0 });
  items += 2;
  did.push(`extrude ${w}×${d}×${h}`);

  // The Box preset (40 × 30 × 20) beside it, its width typed: W × 30 × 20.
  const W = between(41, 60);
  await insertPreset(page, "box");
  await untilShown(page, 2);
  await pinProperties(page);
  await page.fill("#width", String(W));
  await page.press("#width", "Enter");
  await until(page, (x) => document.querySelector("#width")?.value === x, String(W));
  bodies.push({ w: W, d: 30, h: 20, z: 0 });
  items += 1;
  did.push(`box ${W}`);

  // Most cycles lift the box by Move: picked by its Bodies row, Modify ▾'s Move, z typed, OK.
  if (i <= 2 || random() < 0.7) {
    const dz = between(1, 25);
    await pickBody(page, 2);
    await until(page, () => document.body.dataset.selection?.startsWith("body:"));
    await page.click("#move");
    await until(page, () => document.getElementById("move-panel")?.hidden === false);
    await page.fill("#move-z", String(dz));
    await page.click("#move-ok");
    await until(page, () => document.getElementById("move-panel")?.hidden === true);
    bodies[1].z = dz;
    items += 1;
    did.push(`move ${dz}`);
  }
  const built = await state(page);
  // Each body's own volume, as Properties shows it with its Bodies row picked.
  for (const [n, b] of bodies.entries()) {
    await pickBody(page, n + 1);
    const want = `${(b.w * b.d * b.h).toLocaleString("en")} mm³`;
    const shown = await page.waitForFunction((v) => document.querySelector("#volume")?.textContent === v, want, { timeout: 3000 }).then(() => want, () => page.textContent("#volume"));
    if (shown !== want) fail(i, [`${at}: Body ${n + 1} (${b.w} × ${b.d} × ${b.h}) shows a volume of ${shown}, the model ${want}`]);
  }
  await page.keyboard.press("Escape");
  fail(i, matchesModel(built, expected(bodies), items).map((x) => `${at}, built ${JSON.stringify(bodies)}: ${x} (STL bounds ${JSON.stringify(built.stl.bounds)}, timeline ${JSON.stringify(built.items)})`));

  // k Undos and k Redos give the same design back.
  const k = between(1, items);
  for (let n = 0; n < k; n++) await page.click("#undo");
  await rebuilt(page);
  for (let n = 0; n < k; n++) await page.click("#redo");
  await untilShown(page, 2);
  fail(i, sameState(built, await state(page), `${at}, after ${k} Undos and ${k} Redos`));

  // Another workspace and back; split view opened and closed (wide screens only: there is no split view on a phone).
  did.push(`undo ${k}`);
  if (i <= 2 || random() < 0.6) {
    const id = OTHERS[Math.floor(random() * OTHERS.length)];
    await visit(id);
    did.push(id);
  }
  // Never in cycle 2, so the warm-up ends one cycle with the Move's handles still made, whatever the screen (see the warm-up).
  if (screen === WIDE && i !== 2 && (i === 1 || random() < 0.5)) {
    did.push("split");
    await page.click("#split-toggle");
    await until(page, () => !!document.body.dataset.split);
    await page.click("#split-close");
    await until(page, () => !document.body.dataset.split);
  }

  // Saved, emptied by New, opened again: the same design.
  await save(page, saveFile);
  await emptyDesign(page);
  await open(page, saveFile, 2);
  fail(i, sameState(built, await state(page), `${at}, saved, New, opened again`));

  // Every SOAK_EVERY cycles, a from-scratch rebuild: a fresh page opens the file, gets the same design, and saves the same file.
  if (i % EVERY === 0) {
    const fresh = await browser.newContext({ viewport: WIDE, acceptDownloads: true });
    try {
      const other = await openApp(fresh, "a fresh page");
      await open(other, saveFile, 2);
      fail(i, sameState(built, await state(other), `${at}, the file opened in a fresh page`));
      await save(other, resaved);
      const [was, now] = [JSON.parse(readFileSync(saveFile, "utf8")), JSON.parse(readFileSync(resaved, "utf8"))];
      if (JSON.stringify(was) !== JSON.stringify(now)) fail(i, [`${at}, the fresh page saved a different file than it opened: ${firstDifference(was, now)}`]);
    } finally {
      await fresh.close();
    }
  }
  await emptyDesign(page);
  await page.setViewportSize(WIDE);
  console.log(`cycle ${i}: ${did.join(", ")}`);
}

/** The first place two JSON values differ, as a path and both values. */
function firstDifference(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path || "the file"}: ${JSON.stringify(a)?.slice(0, 120)} became ${JSON.stringify(b)?.slice(0, 120)}`;
}

/**
 * DOM nodes the app holds: every node in the page (elements, text,
 * comments) plus every node of a detached tree that JavaScript still holds
 * (DevTools' detached-nodes list: the leaks this test found were there).
 * Chromium's own count (`Nodes`) also counts text the browser's typing
 * history keeps: each Undo step of a number box someone typed in holds the
 * box's old text once the app sets its value (a heap snapshot on
 * 2026-10-29: one blink::UndoStep and one Text more per width typed, none
 * when the value was set without typing), up to Chromium's 1,000 steps, so
 * it is kept in the readings but not judged.
 */
async function domNodes() {
  const inPage = await page.evaluate(() => {
    const walk = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    let n = 0;
    while (walk.nextNode()) n++;
    return n;
  });
  // DevTools keeps every node it has named alive until its DOM agent is switched off again, so it is on only while asking:
  // left on, each reading kept whatever detached tree was waiting for collection then (a download's link), forever.
  await cdp.send("DOM.enable");
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  await cdp.send("DOM.disable");
  if (process.env.SOAK_DEBUG) await printCensus(detachedNodes);
  // A file handed to the browser (save-file.ts `download`) is a link never put in the page: Chromium holds it while the
  // download starts, so a reading taken then counted it or not by chance (1,144 or 1,145 over 30 wide cycles).
  const held = detachedNodes.filter((d) => !(d.treeNode.nodeName === "A" && d.treeNode.attributes?.includes("download")));
  return inPage + held.reduce((s, d) => s + d.retainedNodeIds.length, 0);
}

/** SOAK_DEBUG: the page's nodes by name and nearest id, and the detached trees by their root, printed where they differ from the last reading. */
let lastCensus = {};
async function printCensus(detachedNodes) {
  const census = await page.evaluate(() => {
    const m = {};
    const walk = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const key = `${n.nodeName} in ${(n.nodeType === 1 ? n : n.parentNode)?.closest?.("[id]")?.id}`;
      m[key] = (m[key] ?? 0) + 1;
    }
    return m;
  });
  for (const d of detachedNodes) {
    const key = `detached ${d.treeNode.nodeName} ${JSON.stringify(d.treeNode.attributes).slice(0, 80)}`;
    census[key] = (census[key] ?? 0) + d.retainedNodeIds.length;
  }
  for (const key of new Set([...Object.keys(lastCensus), ...Object.keys(census)])) if ((lastCensus[key] ?? 0) !== (census[key] ?? 0)) console.log(`  ${key}: ${lastCensus[key] ?? 0} -> ${census[key] ?? 0}`);
  lastCensus = census;
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
  return { cycle: cycleNo, heap: metrics.JSHeapUsedSize, nodes: await domNodes(), chromiumNodes: metrics.Nodes, listeners: metrics.JSEventListeners, documents: metrics.Documents, ...hooks };
}

const t0 = Date.now();
const readings = [];
let failure = null;
try {
  // Warm-up before the first reading: snap to grid ticked in a sketch (it lasts for the page) and that sketch undone, every workspace visited, the phone width shown,
  // and a box moved (the Move's handles made once). The main view keeps the Move's 20 handle geometries once made, until split
  // view remakes it, so readings go 11 or 31 by the cycle's last steps; cycle 2 (phone width, no split view) puts 31 in the warm-up's high.
  await sketchOnGround(page);
  await gridSnapOn(page);
  await page.keyboard.press("ControlOrMeta+z");
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true");
  for (const id of OTHERS) await visit(id);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(300);
  await page.setViewportSize(WIDE);
  await insertPreset(page, "box");
  await untilShown(page, 1);
  await pickBody(page, 1);
  await page.click("#move");
  await until(page, () => document.getElementById("move-panel")?.hidden === false);
  await page.fill("#move-z", "5");
  await page.click("#move-ok");
  await until(page, () => document.getElementById("move-panel")?.hidden === true);
  await emptyDesign(page);
  readings.push(await reading(0));

  const random = rng(SEED);
  for (let i = 1; i <= CYCLES; i++) {
    await cycle(i, random);
    // Every cycle of the warm-up is read, so its high includes cycle 2's end (see the warm-up above).
    if (i <= CYCLES * WARM_UP || i % EVERY === 0 || i === CYCLES) {
      const r = await reading(i);
      readings.push(r);
      console.log(`cycle ${i}: heap ${(r.heap / 1e6).toFixed(2)} MB, nodes ${r.nodes}, listeners ${r.listeners}, bodies ${r.bodies}, wasm ${(r.wasm / 1e6).toFixed(1)} MB, geometries ${r.geometries}, textures ${r.textures}, programs ${r.programs}, objects ${r.objects}${problems.length ? `; ${problems.length} design problems so far` : ""}`);
    }
  }
} catch (e) {
  failure = e;
  if (process.env.SOAK_SHOT) await page.screenshot({ path: process.env.SOAK_SHOT }).catch(() => {});
}
const seconds = (Date.now() - t0) / 1000;
await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));

if (process.env.SOAK_REPORT) {
  mkdirSync(dirname(process.env.SOAK_REPORT), { recursive: true });
  writeFileSync(process.env.SOAK_REPORT, JSON.stringify({ seed: SEED, cycles: CYCLES, seconds, readings, problems, errors }, null, 2));
}
for (const p of problems) console.log(`FAIL ${p}`);
if (failure) {
  console.log(`FAIL the soak's cycle stopped (seed ${SEED}): ${failure.message.split("\n").slice(0, 3).join(" ")}`);
  process.exit(1);
}
// Reading 0 is reported but not judged: taken straight after the warm-up's tour, it held more than any cycle's end
// (1,222 nodes against 1,144 on 2026-10-29), so as the warm-up's high it hid 60 nodes of growth over 40 cycles.
const more = [...judgeSoak(readings.filter((r) => r.cycle > 0)), ...errors.map((e) => `the page said: ${e}`)];
for (const p of more) console.log(`FAIL ${p}`);
problems = [...problems, ...more];
console.log(`${problems.length ? "FAIL" : "PASS"} soak: seed ${SEED}, ${CYCLES} cycles in ${seconds.toFixed(0)} s`);
process.exit(problems.length ? 1 : 0);
