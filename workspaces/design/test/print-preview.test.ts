// The print preview and its time-lapse (print-preview.ts): the speeds and
// words worked by hand, the panel in a real DOM (happy-dom) with a stand-in
// 3D view, and a real 20 mm cube from the shipped build played through the
// replayer, checked against the engine's own preview layers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { momentAt, playback, type Playback } from "@fission/core";
import { replay } from "@fission/core/gcode";
import { checkLayers, checkPrinter, checkProblems } from "../../../packages/testing/src/gcode-checks.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { partDocument } from "../src/document.ts";
import { chipKinds, defaultSpeed, kindsIn, layerWords, MAX_FRAME_MS, NO_SUPPORTS, openPrintPreview, presetKinds, type PreviewView } from "../src/print-preview.ts";
import { PRINT_DEFAULTS, sliceBodies } from "../src/slice-print.ts";

const A = Math.PI * 0.875 * 0.875;
const line = 0.8 / A;
// Two layers by hand (as core's print-playback test): the clock runs 0.02 s lift, three 0.5 s lines to 1.52,
// a 0.02 s lift to 1.54, one more 0.5 s line to 2.04.
const TWO_LAYERS = ["G90", "M82", "G92 E0", "G1 Z0.2 F600", ";TYPE:Outer wall", `G1 X10 Y0 E${line} F1200`, `G1 X10 Y10 E${2 * line}`, ";TYPE:Sparse infill", `G1 X0 Y10 E${3 * line}`, "G1 Z0.4 F600", ";TYPE:Outer wall", `G1 X10 Y10 E${4 * line} F1200`].join("\n");

test("hand-worked: the default speed plays the whole print in 40 s or less", () => {
  // 30 s at 1× is 30 s; 400 s at 10× is exactly 40 s; 401 s needs 100× (4.01 s); 2 days at 1,000× is still 173 s, the fastest offered.
  assert.equal(defaultSpeed(30), 1);
  assert.equal(defaultSpeed(400), 10);
  assert.equal(defaultSpeed(401), 100);
  assert.equal(defaultSpeed(172800), 1000);
});

test("the layer words and the legend's kinds", () => {
  const p = playback(TWO_LAYERS);
  assert.equal(layerWords(p, 0), "Layer 1 of 2 · 0.20 mm");
  assert.equal(layerWords(p, 5), "Layer 2 of 2 · 0.40 mm");
  assert.equal(layerWords(playback(""), 0), "No layers");
  assert.deepEqual(kindsIn(p), ["outer-wall", "sparse-infill"]);
});

test("hand-worked: the Show card's choices, of the kinds a print has", () => {
  const withSupports = ["outer-wall", "sparse-infill", "support", "prime"] as const;
  // Everything is every kind the print has; No supports takes support away; Only supports keeps it alone.
  assert.deepEqual([...presetKinds("all", withSupports)], ["outer-wall", "sparse-infill", "support", "prime"]);
  assert.deepEqual([...presetKinds("no-supports", withSupports)], ["outer-wall", "sparse-infill", "prime"]);
  assert.deepEqual([...presetKinds("only-supports", withSupports)], ["support"]);
  // A print without supports: Only supports shows nothing (so its button is off), and Support still gets a chip.
  assert.deepEqual([...presetKinds("only-supports", ["outer-wall"])], []);
  assert.deepEqual(chipKinds(playback(TWO_LAYERS)), ["outer-wall", "sparse-infill", "support"]);
});

const { Window } = await import("happy-dom");

function panel(gcode: string, broken = false) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const times: number[] = [];
  const shown: { kinds: string[]; travel: boolean }[] = [];
  let disposed = 0;
  const p = playback(gcode);
  const make = (_host: HTMLElement, _p: Playback): PreviewView => {
    if (broken) throw new Error("no WebGL");
    return { setTime: (t) => times.push(t), setShown: (k, travel) => shown.push({ kinds: [...k].sort(), travel }), frame() {}, resize() {}, dispose: () => void disposed++ };
  };
  const preview = openPrintPreview(slot, p, "2 layers, 0.0 g of PLA (0.00 m of filament).", make);
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  return { preview, times, shown, disposed: () => disposed, $, window, p };
}

test("the preview opens on the finished print; the layer slider shows the print up to a layer", async () => {
  const t = panel(TWO_LAYERS);
  assert.equal(t.preview.open, true);
  assert.equal(t.preview.time, 2.04);
  assert.equal(t.times.at(-1), 2.04);
  assert.equal(t.$<HTMLInputElement>("print-preview-scrub").value, "1000");
  assert.equal(t.$("print-preview-layer-words").textContent, "Layer 2 of 2 · 0.40 mm");
  assert.equal(t.$<HTMLInputElement>("print-preview-layers").max, "2");
  assert.deepEqual([...t.$("print-preview-legend").children].map((c) => c.textContent), ["Outer wall", "Sparse infill", "Support (none)", "Travel"]);
  // The slider at layer 1: the clock at the end of layer 1, 1.52 s.
  const slider = t.$<HTMLInputElement>("print-preview-layers");
  slider.value = "1";
  slider.dispatchEvent(new t.window.Event("input") as unknown as Event);
  assert.ok(Math.abs(t.times.at(-1)! - 1.52) < 1e-12);
  assert.equal(t.$("print-preview-layer-words").textContent, "Layer 1 of 2 · 0.20 mm");
  // The scrubber halfway: 1.02 s of the 2.04 s clock.
  const scrub = t.$<HTMLInputElement>("print-preview-scrub");
  scrub.value = "500";
  scrub.dispatchEvent(new t.window.Event("input") as unknown as Event);
  assert.ok(Math.abs(t.preview.time - 1.02) < 1e-12);
  t.$("print-preview-close").click();
  assert.equal(t.preview.open, false);
  assert.equal(t.disposed(), 1);
  await t.window.happyDOM.close();
});

test("Play starts from the first move at the end, moves at the chosen speed and stops at the end", async () => {
  const t = panel(TWO_LAYERS);
  // 2.04 s of clock fits 40 s at 1×.
  assert.equal(t.$<HTMLSelectElement>("print-preview-speed").value, "1");
  t.$("print-preview-play").click();
  assert.equal(t.preview.playing, true);
  assert.equal(t.preview.time, 0);
  assert.equal(t.$("print-preview-play").textContent, "Pause");
  // 500 ms at 1× is 0.5 s of clock; then at 10×, 100 ms is 1 s more.
  t.preview.advance(500);
  assert.ok(Math.abs(t.preview.time - 0.5) < 1e-12);
  t.$<HTMLSelectElement>("print-preview-speed").value = "10";
  t.preview.advance(100);
  assert.ok(Math.abs(t.preview.time - 1.5) < 1e-12);
  // Past the end it stops at the end.
  t.preview.advance(10000);
  assert.equal(t.preview.time, 2.04);
  assert.equal(t.preview.playing, false);
  assert.equal(t.$("print-preview-play").textContent, "Play");
  // A broken clock tick (not a positive number) changes nothing.
  t.preview.advance(Number.NaN);
  t.preview.advance(-5);
  assert.equal(t.preview.time, 2.04);
  t.preview.close();
  await t.window.happyDOM.close();
});

test("regression: a long gap between frames moves the time-lapse on by one frame's worth at most, never to its end", async () => {
  // Found by the H2d2 browser test: a frame that took 2.7 s (a computer drawing without a graphics card) moved the
  // clock 27 s at 10×, so the print ran to its end while the user went to press Pause, and the press started it again.
  // A tab hidden for a minute did the same when it came back. Each frame now moves on at most MAX_FRAME_MS of real time.
  const t = panel(TWO_LAYERS);
  const frames: FrameRequestCallback[] = [];
  t.window.requestAnimationFrame = ((f: FrameRequestCallback) => frames.push(f)) as typeof t.window.requestAnimationFrame;
  const tick = (now: number) => frames.shift()!(now);
  t.$("print-preview-play").click();
  assert.equal(t.preview.time, 0);
  tick(1000); // the first frame only notes the time
  // 60 s later at 1×: 0.1 s of clock (MAX_FRAME_MS is 100), not 60 s (past the 2.04 s end).
  tick(61000);
  assert.equal(MAX_FRAME_MS, 100);
  assert.ok(Math.abs(t.preview.time - 0.1) < 1e-12, `${t.preview.time}`);
  assert.equal(t.preview.playing, true);
  // At the cap's edges: a 90 ms frame (0.9×) moves 0.09 s, all of it; a 110 ms frame (1.1×) moves the cap's 0.1 s.
  tick(61090);
  assert.ok(Math.abs(t.preview.time - 0.19) < 1e-12, `${t.preview.time}`);
  tick(61200);
  assert.ok(Math.abs(t.preview.time - 0.29) < 1e-12, `${t.preview.time}`);
  t.preview.close();
  await t.window.happyDOM.close();
});

// TWO_LAYERS with its infill line marked as support, as the slicer will write supports.
const WITH_SUPPORT = TWO_LAYERS.replace(";TYPE:Sparse infill", ";TYPE:Support");

test("each kind's switch, Travel and the one-tap choices tell the view what to draw, the clock untouched", async () => {
  const t = panel(WITH_SUPPORT);
  const pressed = (id: string) => t.$(id).getAttribute("aria-pressed");
  // Opens with every kind on and travel off.
  assert.deepEqual(t.shown.at(-1), { kinds: ["outer-wall", "support"], travel: false });
  assert.equal(pressed("print-preview-preset-all"), "true");
  assert.equal(t.$<HTMLButtonElement>("print-preview-preset-only-supports").disabled, false);
  assert.equal(t.$("print-preview-no-supports"), null);
  // Only supports: the walls go, the support stays, and only that choice is lit.
  t.$("print-preview-preset-only-supports").click();
  assert.deepEqual(t.shown.at(-1), { kinds: ["support"], travel: false });
  assert.equal(pressed("print-preview-show-outer-wall"), "false");
  assert.equal(pressed("print-preview-show-support"), "true");
  assert.equal(pressed("print-preview-preset-only-supports"), "true");
  assert.equal(pressed("print-preview-preset-all"), "false");
  // No supports, then the walls switched off by hand too: nothing is drawn, no choice lit.
  t.$("print-preview-preset-no-supports").click();
  assert.deepEqual(t.shown.at(-1), { kinds: ["outer-wall"], travel: false });
  t.$("print-preview-show-outer-wall").click();
  assert.deepEqual(t.shown.at(-1), { kinds: [], travel: false });
  for (const c of ["all", "no-supports", "only-supports"]) assert.equal(pressed(`print-preview-preset-${c}`), "false");
  // Travel on and off by its own switch, whatever the kinds.
  t.$("print-preview-show-travel").click();
  assert.deepEqual(t.shown.at(-1), { kinds: [], travel: true });
  assert.equal(pressed("print-preview-show-travel"), "true");
  // Back to Everything; travel stays as it was set. The clock never moved.
  t.$("print-preview-preset-all").click();
  assert.deepEqual(t.shown.at(-1), { kinds: ["outer-wall", "support"], travel: true });
  assert.equal(t.preview.time, 2.04);
  assert.deepEqual([...t.preview.shown].sort(), ["outer-wall", "support"]);
  t.preview.close();
  await t.window.happyDOM.close();
});

test("a slice without supports says so: their switch and both supports choices are off", async () => {
  const t = panel(TWO_LAYERS);
  const support = t.$<HTMLButtonElement>("print-preview-show-support");
  assert.equal(support.disabled, true);
  assert.equal(support.textContent, "Support (none)");
  assert.equal(t.$<HTMLButtonElement>("print-preview-preset-only-supports").disabled, true);
  assert.equal(t.$<HTMLButtonElement>("print-preview-preset-no-supports").disabled, true);
  assert.equal(t.$("print-preview-no-supports").textContent, NO_SUPPORTS);
  // A click on the disabled switch does nothing.
  const before = t.shown.length;
  support.click();
  assert.equal(t.shown.length, before);
  t.preview.close();
  await t.window.happyDOM.close();
});

test("without WebGL the preview says so instead of a blank view", async () => {
  const t = panel(TWO_LAYERS, true);
  assert.match(t.$("print-preview-view").textContent!, /needs WebGL/);
  t.preview.close();
  assert.equal(t.disposed(), 0);
  await t.window.happyDOM.close();
});

test("a 20 mm cube from the shipped build plays as the engine sliced it: 100 layers of 0.2 mm, every layer's kinds the same", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const print = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  const p = playback(print.gcode);
  assert.deepEqual(p.problems, []);
  // 20 mm / 0.2 mm: 100 layers, each 0.2 mm, the top at 20.
  assert.equal(p.layers.length, 100);
  for (const l of p.layers) assert.ok(Math.abs(l.height - 0.2) < 1e-6, `height ${l.height} at ${l.z}`);
  assert.ok(Math.abs(p.layers[99].z - 20) < 1e-6);
  // Two code paths agreeing: the replayed G-code's layers and the engine's own preview layers, height and kinds.
  const roleKind = { "outer-wall": "outer-wall", "inner-wall": "inner-wall", "solid-infill": "solid-infill", "sparse-infill": "sparse-infill" } as const;
  for (let k = 0; k < 100; k++) {
    assert.ok(Math.abs(p.layers[k].z - print.preview[k].zTop) < 1e-6);
    const played = new Set<string>();
    for (let i = 0; i < p.count; i++) if (p.plastic[i] && p.layer[i] === k && p.kind[i] !== "prime") played.add(p.kind[i]);
    assert.deepEqual([...played].sort(), [...new Set(print.preview[k].paths.map((x) => roleKind[x.role]))].sort(), `layer ${k}`);
  }
  // Every line laid is about one 0.4 mm line wide (0.3 to 0.6: walls and infill differ a little).
  for (let i = 0; i < p.count; i++) if (p.plastic[i] && p.kind[i] !== "prime") assert.ok(p.width[i] > 0.3 && p.width[i] < 0.6, `width ${p.width[i]} of ${p.kind[i]}`);
});

test("hand-worked: a 20 mm cube's first layer, and every line as wide as the G-code says", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const print = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  const r = replay(print.gcode);
  const p = playback(print.gcode);
  // The slice has no arcs, so the playback's pieces are the replayer's moves one for one.
  assert.equal(p.count, r.moves.length);
  // Each line's width as the file states it: the last `;WIDTH:` comment before the move.
  const lines = print.gcode.split("\n");
  const stated: number[] = [];
  let w = Number.NaN;
  for (const l of lines) {
    const m = /^;WIDTH:([\d.]+)/.exec(l);
    stated.push(m ? (w = Number(m[1])) : w);
  }
  let checked = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.plastic[i] || p.kind[i] === "prime") continue;
    const want = stated[r.moves[i].line - 1];
    if (!Number.isFinite(want)) continue;
    // E has five decimals (about 1e-5 of a 0.6 mm push), so the width read back is good to well under 1e-3 mm.
    assert.ok(Math.abs(p.width[i] - want) < 1e-3, `line ${r.moves[i].line}: ${p.width[i]} drawn, ${want} stated`);
    checked++;
  }
  assert.ok(checked > 1000, `${checked} lines checked`);

  // The outer wall of the first layer, by hand: the cube's faces are 20 mm apart and the outer line is
  // 0.42 mm wide, laid flush with them, so its centre runs 0.21 mm in: a square of side 20 − 0.42 = 19.58 mm,
  // 4 × 19.58 = 78.32 mm round. The file prints it at F3000, 50 mm/s: 78.32 ÷ 50 = 1.5664 s.
  const outer = [...Array(p.count).keys()].filter((i) => p.plastic[i] && p.layer[i] === 0 && p.kind[i] === "outer-wall");
  assert.equal(outer.length, 4);
  const length = (i: number) => Math.hypot(p.to[3 * i] - p.from[3 * i], p.to[3 * i + 1] - p.from[3 * i + 1]);
  for (const i of outer) assert.ok(Math.abs(length(i) - 19.58) < 1e-9, `side ${length(i)}`);
  const time = outer.reduce((t, i) => t + p.finish[i] - p.start[i], 0);
  assert.ok(Math.abs(time - 1.5664) < 1e-9, `outer wall ${time} s`);
  // Halfway through the first side's time the nozzle is halfway along it, 0.2 mm above the bed.
  const [a] = outer;
  const at = momentAt(p, (p.start[a] + p.finish[a]) / 2)!;
  assert.equal(at.piece, a);
  for (const k of [0, 1]) assert.ok(Math.abs(at.nozzle[k] - (p.from[3 * a + k] + p.to[3 * a + k]) / 2) < 1e-9);
  assert.ok(Math.abs(at.nozzle[2] - 0.2) < 1e-9);
  // And the square is the cube's footprint shrunk by 0.21 mm all round: 19.58 across in x and in y.
  const xs = outer.flatMap((i) => [p.from[3 * i], p.to[3 * i]]);
  const ys = outer.flatMap((i) => [p.from[3 * i + 1], p.to[3 * i + 1]]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 19.58) < 1e-9 && Math.abs(Math.max(...ys) - Math.min(...ys) - 19.58) < 1e-9);

  // The replayer's own checks pass on everything the preview shows: the file followed faithfully, on the P1S's
  // 256 × 256 mm plate and 250 mm height, layers going up within the limits and every wall closed.
  assert.deepEqual(checkProblems(r), []);
  assert.deepEqual(checkLayers(r, 1e-3), []);
  assert.deepEqual(checkPrinter(r, { bed: { x: 256, y: 256 }, height: 250, maxFeed: 30000, maxNozzle: 300, maxBed: 110 }), []);
});
