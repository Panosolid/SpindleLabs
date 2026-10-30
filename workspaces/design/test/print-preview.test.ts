// The print preview and its time-lapse (print-preview.ts): the speeds and
// words worked by hand, the panel in a real DOM (happy-dom) with a stand-in
// 3D view, and a real 20 mm cube from the shipped build played through the
// replayer, checked against the engine's own preview layers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback, type Playback } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { partDocument } from "../src/document.ts";
import { defaultSpeed, kindsIn, layerWords, openPrintPreview, type PreviewView } from "../src/print-preview.ts";
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

const { Window } = await import("happy-dom");

function panel(gcode: string, broken = false) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const times: number[] = [];
  let disposed = 0;
  const p = playback(gcode);
  const make = (_host: HTMLElement, _p: Playback): PreviewView => {
    if (broken) throw new Error("no WebGL");
    return { setTime: (t) => times.push(t), frame() {}, resize() {}, dispose: () => void disposed++ };
  };
  const preview = openPrintPreview(slot, p, "2 layers, 0.0 g of PLA (0.00 m of filament).", make);
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  return { preview, times, disposed: () => disposed, $, window, p };
}

test("the preview opens on the finished print; the layer slider shows the print up to a layer", async () => {
  const t = panel(TWO_LAYERS);
  assert.equal(t.preview.open, true);
  assert.equal(t.preview.time, 2.04);
  assert.equal(t.times.at(-1), 2.04);
  assert.equal(t.$<HTMLInputElement>("print-preview-scrub").value, "1000");
  assert.equal(t.$("print-preview-layer-words").textContent, "Layer 2 of 2 · 0.40 mm");
  assert.equal(t.$<HTMLInputElement>("print-preview-layers").max, "2");
  assert.deepEqual([...t.$("print-preview-legend").children].map((c) => c.textContent), ["Outer wall", "Sparse infill"]);
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
