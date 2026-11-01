// Slice for printing (slice-print.ts): the files handed to the engine, the
// words a slice is described in (worked by hand), the dialog in a real DOM
// (happy-dom) with a stand-in slicer, and real slices on the shipped kernel build (a 20 mm cube; supports under a plate on a column;
// the cube's P1S print file, unpacked by the test's own reader).
// The Chromium checks are apps/fission/e2e/slice-print.mjs and print-preview.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback, type SlicedPrint } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { bodyIdOf, insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { createHash } from "node:crypto";
import { FILE_DEFAULTS, gcodeName, gcodeOfPackage, NOZZLE_KEY, printMovesOf, refusalWords, rememberedNozzle, SliceDropped, PRINT_DEFAULTS, printFileName, printFileOf, levelNote, printWords, sliceBodies, slicePrint, stackStl, stlLowestZ, timeWords, unprintedWords, type FileChoices, type PrintChoices, type PrintFacts } from "../src/slice-print.ts";

const print = (over: Partial<SlicedPrint> = {}): SlicedPrint => ({ gcode: "G1 X1\n", layers: 100, filamentMm: 1730, filamentG: 5.16, retractions: 0, unprintedVolume: 0, printTimeS: 257, preview: [], ...over });

test("the bodies' files go to the engine back to back, each whole", () => {
  // [1, 2] then [3] then nothing then [4, 5]: 1, 2, 3, 4, 5 in that order.
  assert.deepEqual([...stackStl([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([]), new Uint8Array([4, 5])])], [1, 2, 3, 4, 5]);
  assert.equal(stackStl([]).length, 0);
});

test("a slice in words, worked by hand", () => {
  // 1730 mm is 1.73 m; 5.16 g is under 10, so to one decimal: 5.2 g; 257 s is 4.28 min, so 4 min.
  assert.equal(printWords(print()), "100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  // 12.6 g is 10 or more, so a whole number: 13 g. One layer is "layer". 3900 s is 65 min: 1 h 5 min.
  assert.equal(printWords(print({ layers: 1, filamentG: 12.6, filamentMm: 4220, printTimeS: 3900 })), "1 layer, 13 g of PLA (4.22 m of filament), about 1 h 5 min of printing (plus heating and levelling).");
  // An engine fault (not a number) shows no time rather than a wrong one.
  assert.equal(printWords(print({ printTimeS: Number.NaN })), "100 layers, 5.2 g of PLA (1.73 m of filament).");
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "off" }), "spindlelabs-0.16mm-3w-20pc.gcode");
  // Supports on gets its own name, so the same part with and without never overwrite each other.
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "normal" }), "spindlelabs-0.16mm-3w-20pc-supports.gcode");
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "tree" }), "spindlelabs-0.16mm-3w-20pc-tree-supports.gcode");
  // The P1S's defaults, the engine's own: 0.2 mm layers, 2 walls, 15 %, no supports.
  assert.deepEqual(PRINT_DEFAULTS, { layerHeight: 0.2, walls: 2, infill: 15, supports: "off" });
});

test("print time in words rounds to the nearest minute, worked by hand", () => {
  // Half a minute is where rounding turns over: 29 s is 0.48 min (0), 30 s is 0.5 min (1).
  assert.equal(timeWords(0), "under a minute");
  assert.equal(timeWords(29), "under a minute");
  assert.equal(timeWords(30), "1 min");
  // 3569 s is 59.48 min (59); 3570 s is 59.5 min, which rounds to 60: a whole hour, no "0 min".
  assert.equal(timeWords(3569), "59 min");
  assert.equal(timeWords(3570), "1 h");
  // 7 h 23 min = 26580 s; 2 s either side still rounds to it.
  assert.equal(timeWords(26580 + 2), "7 h 23 min");
  assert.equal(timeWords(26580 - 2), "7 h 23 min");
  // Faults give no figure: not a number, below 0, endless.
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) assert.equal(timeWords(bad), null, String(bad));
});

test("plastic left out is warned about from half a hundredth of a mm³ (it rounds to 0.01): 0.9× stays quiet, 1.1× warns", () => {
  assert.equal(unprintedWords(print()), null);
  assert.equal(unprintedWords(print({ unprintedVolume: 0.005 * 0.9 })), null);
  assert.equal(unprintedWords(print({ unprintedVolume: 0.005 * 1.1 })), "Some of the part is thinner than one printed line, so about 0.01 mm³ of it won't print.");
  assert.match(unprintedWords(print({ unprintedVolume: 12.345 }))!, /about 12\.35 mm³/);
  // Not a number (an engine fault) gives no figure to warn with.
  assert.equal(unprintedWords(print({ unprintedVolume: Number.NaN })), null);
});

const { Window } = await import("happy-dom");

/** The name a stand-in saves under: the one the workspace offers. */
const nameFor = (c: PrintChoices, f: FileChoices) => (f.format === "p1s" ? printFileName(c, f.plate, f.nozzle) : gcodeName(c));

function dialog(slice: (c: PrintChoices, f: FileChoices, alive: () => boolean) => Promise<{ print: PrintFacts; saved: boolean; name?: string }>, preview: (c: PrintChoices, f: FileChoices, alive: () => boolean) => Promise<void> = async () => {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const keys: string[] = [];
  doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  const asked: PrintChoices[] = [];
  const files: FileChoices[] = [];
  const d = slicePrint(slot, {
    slice: async (c, f, alive) => {
      asked.push(c);
      files.push(f);
      const r = await slice(c, f, alive);
      return { ...r, name: r.name ?? nameFor(c, f) };
    },
    preview: (c, f, alive) => (asked.push(c), files.push(f), preview(c, f, alive)),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { d, doc, keys, asked, files, $, settle, window };
}

test("the dialog slices with the choices picked, then says what the slice came to", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  assert.equal(t.d.open, false);
  t.d.ask();
  assert.equal(t.d.open, true);
  // The defaults are what it opens on.
  assert.equal(t.$<HTMLSelectElement>("slice-print-quality").value, "0.2");
  assert.equal(t.$<HTMLSelectElement>("slice-print-walls").value, "2");
  assert.equal(t.$<HTMLSelectElement>("slice-print-infill").value, "15");
  assert.equal(t.$<HTMLSelectElement>("slice-print-supports").value, "off");
  assert.deepEqual([...t.$<HTMLSelectElement>("slice-print-supports").options].map((o) => o.textContent), ["Off", "Normal (columns)", "Tree (less plastic)"]);
  t.$<HTMLSelectElement>("slice-print-quality").value = "0.16";
  t.$<HTMLSelectElement>("slice-print-walls").value = "3";
  t.$<HTMLSelectElement>("slice-print-infill").value = "40";
  // Plain G-code here; the P1S's file (the default) has its own test below.
  t.$<HTMLSelectElement>("slice-print-format").value = "gcode";
  t.$<HTMLSelectElement>("slice-print-format").dispatchEvent(new t.window.Event("change") as unknown as Event);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked, [{ layerHeight: 0.16, walls: 3, infill: 40, supports: "off" }]);
  assert.equal(t.$("slice-print-status").textContent, "Saved spindlelabs-0.16mm-3w-40pc.gcode: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), false);
  // Normal supports picked: the next slice asks for them, and the file's name says so; then trees, likewise.
  t.$<HTMLSelectElement>("slice-print-supports").value = "normal";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked[1], { layerHeight: 0.16, walls: 3, infill: 40, supports: "normal" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.16mm-3w-40pc-supports\.gcode: /);
  t.$<HTMLSelectElement>("slice-print-supports").value = "tree";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked[2], { layerHeight: 0.16, walls: 3, infill: 40, supports: "tree" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.16mm-3w-40pc-tree-supports\.gcode: /);
  t.$("slice-print-close").click();
  assert.equal(t.d.open, false);
  await t.window.happyDOM.close();
});

test("the dialog saves the P1S's print file by default, for the plate picked; the plate goes with that file only", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  const format = t.$<HTMLSelectElement>("slice-print-format");
  const plate = t.$<HTMLSelectElement>("slice-print-plate");
  // The owner's printer and plate: the P1S file on the textured PEI plate.
  assert.deepEqual(FILE_DEFAULTS, { format: "p1s", plate: "textured", nozzle: "standard" });
  assert.equal(format.value, "p1s");
  assert.equal(plate.value, "textured");
  assert.equal(plate.disabled, false);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files, [{ format: "p1s", plate: "textured", nozzle: "standard" }]);
  // The name by hand: the plain file's spindlelabs-0.2mm-2w-15pc, then the plate, then the P1S's ending.
  assert.equal(t.$("slice-print-status").textContent, "Saved spindlelabs-0.2mm-2w-15pc-textured.gcode.3mf: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  plate.value = "smooth";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files[1], { format: "p1s", plate: "smooth", nozzle: "standard" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-smooth\.gcode\.3mf: /);
  // Plain G-code: the plate box greys out, and the file is .gcode.
  format.value = "gcode";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(plate.disabled, true);
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.files[2].format, "gcode");
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc\.gcode: /);
  // The plain option says it isn't for the P1S (its start primes a line across the corner the P1S keeps clear).
  assert.match(format.querySelector('option[value="gcode"]')!.textContent!, /not for the P1S/);
  format.value = "p1s";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(plate.disabled, false);
  // Names by hand, with supports and the other plate.
  assert.equal(printFileName({ layerHeight: 0.16, walls: 3, infill: 20, supports: "normal" }, "smooth"), "spindlelabs-0.16mm-3w-20pc-supports-smooth.gcode.3mf");
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "high-flow"), "spindlelabs-0.2mm-2w-15pc-textured-high-flow.gcode.3mf");
  await t.window.happyDOM.close();
});

test("the nozzle: Standard by default, High Flow when picked, remembered for next time, P1S file only", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.window.localStorage.clear();
  t.d.ask();
  const nozzle = t.$<HTMLSelectElement>("slice-print-nozzle");
  const format = t.$<HTMLSelectElement>("slice-print-format");
  // Bambu Studio refuses to send a file made for the other nozzle (Ben's 10-31 send: his P1S has High Flow, the file said Standard).
  assert.equal(nozzle.value, "standard");
  assert.deepEqual([...nozzle.options].map((o) => o.textContent), ["0.4 mm Standard", "0.4 mm High Flow"]);
  nozzle.value = "high-flow";
  nozzle.dispatchEvent(new t.window.Event("change") as unknown as Event);
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.files[0], { format: "p1s", plate: "textured", nozzle: "high-flow" });
  assert.match(t.$("slice-print-status").textContent!, /^Saved spindlelabs-0\.2mm-2w-15pc-textured-high-flow\.gcode\.3mf: /);
  // Kept for next time: a printer's nozzle rarely changes.
  assert.equal(t.window.localStorage.getItem(NOZZLE_KEY), "high-flow");
  // Plain G-code: the nozzle box greys out, as the plate's does.
  format.value = "gcode";
  format.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(nozzle.disabled, true);
  await t.window.happyDOM.close();
  // What is read back: ours, or the default for anything else or blocked storage.
  const kept = (v: string | null) => ({ getItem: () => v });
  assert.equal(rememberedNozzle(kept("high-flow")), "high-flow");
  assert.equal(rememberedNozzle(kept("standard")), "standard");
  for (const v of [null, "", "High Flow", "hardened"]) assert.equal(rememberedNozzle(kept(v)), "standard", String(v));
  assert.equal(rememberedNozzle(null), "standard");
  assert.equal(rememberedNozzle({ getItem: () => { throw new Error("blocked"); } }), "standard");
});

test("the dialog says a refusal in the engine's words, warns about plastic left out, and keeps its keys", async () => {
  let answer: () => Promise<{ print: PrintFacts; saved: boolean }> = async () => {
    throw new Error("the part is bigger than the printer's bed");
  };
  const t = dialog(() => answer());
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.$("slice-print-status").textContent, "The part is bigger than the printer's bed", "a message kept, but starting with a capital");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  answer = async () => ({ print: print({ unprintedVolume: 2 }), saved: false });
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(t.$("slice-print-status").textContent, "Sliced, but not saved: 100 layers, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling). Some of the part is thinner than one printed line, so about 2.00 mm³ of it won't print.");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  // A key pressed in the dialog never reaches the app's shortcuts.
  t.$("slice-print-go").dispatchEvent(new t.window.KeyboardEvent("keydown", { key: "e", bubbles: true }) as unknown as Event);
  assert.deepEqual(t.keys, []);
  await t.window.happyDOM.close();
});

test("a second click while slicing doesn't start a second slice", async () => {
  let finish!: () => void;
  const t = dialog(() => new Promise((r) => (finish = () => r({ print: print(), saved: true }))));
  t.d.ask();
  t.$("slice-print-go").click();
  t.$("slice-print-go").click();
  assert.equal(t.asked.length, 1);
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, true);
  assert.equal(t.$("slice-print-status").textContent, "Slicing…");
  finish();
  await t.settle();
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, false);
  await t.window.happyDOM.close();
});

test("Preview slices with the choices picked and closes the dialog; a refusal keeps it open and says why", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$<HTMLSelectElement>("slice-print-infill").value = "25";
  t.$("slice-print-preview").click();
  await t.settle();
  assert.deepEqual(t.asked, [{ layerHeight: 0.2, walls: 2, infill: 25, supports: "off" }]);
  assert.equal(t.d.open, false);
  const bad = dialog(async () => ({ print: print(), saved: true }), async () => {
    throw new Error("There is no body to slice: make or show one first.");
  });
  bad.d.ask();
  bad.$("slice-print-preview").click();
  await bad.settle();
  assert.equal(bad.d.open, true);
  assert.equal(bad.$("slice-print-status").textContent, "There is no body to slice: make or show one first.");
  assert.equal(bad.$<HTMLButtonElement>("slice-print-preview").disabled, false);
  await t.window.happyDOM.close();
  await bad.window.happyDOM.close();
});

test("a 20 mm cube, sliced on the shipped build: 100 layers of 0.2 mm, G-code a printer reads", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const p = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  // 20 mm / 0.2 mm = 100 layers, the first 0.2 mm too; layer k's top is 0.2 × (k + 1).
  assert.equal(p.layers, 100);
  assert.equal(p.preview.length, 100);
  assert.ok(Math.abs(p.preview[99].zTop - 20) < 1e-9, `top ${p.preview[99].zTop}`);
  assert.match(p.gcode, /^G1 /m);
  assert.equal(p.unprintedVolume, 0);
  // Each layer now takes at least the engine's 8 s minimum layer time (Generic PLA), so the moves take at least
  // 100 × 8 = 800 s; the engine's own tests time it at about 863 s, 14 min. Here, that it reaches the app.
  assert.ok(p.printTimeS >= 800, `time ${p.printTimeS}`);
  assert.equal(timeWords(p.printTimeS), "14 min", `time ${p.printTimeS}`);
  // Weight from length: 1.75 mm filament, π × 0.875² mm² × length × 1.24 g/cm³ (self-consistency, not a hand-worked figure).
  assert.ok(Math.abs(p.filamentG - (Math.PI * 0.875 ** 2 * p.filamentMm * 1.24) / 1000) < 1e-6 * p.filamentG);
  // Two walls: layer 50 starts with one outer and one inner wall.
  const roles = p.preview[50].paths.map((x) => x.role);
  assert.equal(roles.filter((r) => r === "outer-wall").length, 1);
  assert.equal(roles.filter((r) => r === "inner-wall").length, 1);
});

test("two bodies print together, each its own mesh; none is refused before slicing", async () => {
  const kernel = nodeKernel();
  const doc = insertPreset(partDocument("box", 20, 20, 20), "box", 10, 10, 30).doc;
  const two = bodyFeatures(doc);
  assert.equal(two.length, 2);
  // The taller box sets the height: 30 mm / 0.2 mm = 150 layers.
  const p = await sliceBodies(kernel, doc, two, PRINT_DEFAULTS);
  assert.equal(p.layers, 150);
  // Planted: the second body's file left out gives the first box's 100 layers, so the count above can fail.
  const one = await sliceBodies(kernel, doc, two.slice(0, 1), PRINT_DEFAULTS);
  assert.equal(one.layers, 100);
  await assert.rejects(sliceBodies(kernel, doc, [], PRINT_DEFAULTS), /no body to slice/);
});

test("supports on the shipped build: a plate on a column gets them, normal or tree, a cube needs none, and off means none", async () => {
  const kernel = nodeKernel();
  // A 30 × 30 × 2 mm plate moved up onto a 10 × 10 × 10 mm column (both centred), made as the app makes them.
  const plate = insertPreset(partDocument("box", 10, 10, 10), "box", 30, 30, 2);
  const doc = insertMove(plate.doc, [bodyIdOf(plate.id)], { ...NO_MOVE, z: 10 }).doc;
  const bodies = bodyFeatures(doc);
  const supportLayers = (p: SlicedPrint) => p.preview.filter((l) => l.paths.some((x) => x.role === "support")).length;
  const on = await sliceBodies(kernel, doc, bodies, { ...PRINT_DEFAULTS, supports: "normal" });
  const tree = await sliceBodies(kernel, doc, bodies, { ...PRINT_DEFAULTS, supports: "tree" });
  const off = await sliceBodies(kernel, doc, bodies, PRINT_DEFAULTS);
  // 12 mm / 0.2 mm = 60 layers either way.
  assert.equal(on.layers, 60);
  assert.equal(off.layers, 60);
  // By hand: the plate's first layer is layer 50 (10.0 to 10.2 mm), its rim past the column hanging in the air.
  // One layer is left empty under it (the gap that lets the support break away), so supports fill layers 0 to 48 from the bed: 49 layers.
  assert.equal(supportLayers(on), 49);
  assert.equal(supportLayers(off), 0);
  // The G-code marks them as the kind "Support", which the preview's switches read.
  assert.match(on.gcode, /^;TYPE:Support$/m);
  assert.doesNotMatch(off.gcode, /;TYPE:Support/);
  // Supports cost plastic and time.
  assert.ok(on.filamentMm > off.filamentMm && on.printTimeS > off.printTimeS, `${on.filamentMm} vs ${off.filamentMm}`);
  // Trees: the same 60 layers and the same roof (support up to layer 48, the gap layer 49 empty), but branches, not columns:
  // a different slice, and less plastic than columns under the whole rim.
  assert.equal(tree.layers, 60);
  const topSupport = (p: SlicedPrint) => Math.max(...p.preview.flatMap((l, i) => (l.paths.some((x) => x.role === "support") ? [i] : [])));
  assert.equal(topSupport(tree), 48);
  assert.equal(topSupport(on), 48);
  assert.match(tree.gcode, /^;TYPE:Support$/m);
  assert.notEqual(tree.gcode, on.gcode);
  assert.ok(tree.filamentMm > off.filamentMm && tree.filamentMm < on.filamentMm, `${tree.filamentMm} between ${off.filamentMm} and ${on.filamentMm}`);
  // A 20 mm cube has nothing hanging out: supports on still adds none.
  const cube = partDocument("box", 20, 20, 20);
  assert.equal(supportLayers(await sliceBodies(kernel, cube, bodyFeatures(cube), { ...PRINT_DEFAULTS, supports: "normal" })), 0);
  assert.equal(supportLayers(await sliceBodies(kernel, cube, bodyFeatures(cube), { ...PRINT_DEFAULTS, supports: "tree" })), 0);
});

/** The files of a ZIP of stored (uncompressed) files, read from its local headers: name → bytes. Throws on anything else. */
function storedZip(b: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    assert.equal(v.getUint16(at + 8, true), 0, "stored, not compressed");
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const extra = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(b.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, b.subarray(start, start + size));
    at = start + size;
  }
  assert.equal(v.getUint32(at, true), 0x02014b50, "the central directory follows the files");
  return out;
}

/** A file's layer moves, feeds left out: from the first layer's first path to the end routine. */
function layerMoves(gcode: string): string[] {
  const start = gcode.indexOf(";LAYER_CHANGE");
  const first = gcode.indexOf(";TYPE:", start);
  const end = gcode.search(/;===== end|; end/);
  return gcode
    .slice(first, end)
    .split("\n")
    .filter((l) => l.startsWith("G0 ") || l.startsWith("G1 "))
    .map((l) => l.split(/\s+/).filter((w) => !w.startsWith("F")).join(" "));
}

test("the cube's P1S print file on the shipped build: a package the printer checks, for the plate picked, the same layers as the plain slice", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const f = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  assert.ok(f.package instanceof Uint8Array, "bytes, not a list of numbers");
  const files = storedZip(f.package);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "Metadata/plate_1.gcode", "Metadata/plate_1.gcode.md5", "Metadata/plate_1.json", "Metadata/slice_info.config"]) assert.ok(files.has(name), name);
  const gcode = new TextDecoder().decode(files.get("Metadata/plate_1.gcode"));
  // The printer checks the G-code against its MD5 (worked here by node's own MD5, apart from the engine's), upper-case hex.
  assert.equal(new TextDecoder().decode(files.get("Metadata/plate_1.gcode.md5")), createHash("md5").update(files.get("Metadata/plate_1.gcode")!).digest("hex").toUpperCase());
  // 20 mm / 0.2 mm = 100 layers, as the file marks them and the answer says.
  assert.equal((gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length, 100);
  assert.equal(f.layers, 100);
  assert.equal(f.unprintedVolume, 0);
  assert.match(gcode, /^; total layer number: 100$/m);
  // The textured plate: its key, and its first layer 0.04 mm lower.
  assert.match(new TextDecoder().decode(files.get("Metadata/plate_1.json")), /"bed_type":"textured_plate"/);
  assert.match(gcode, /^G29\.1 Z-0\.04/m);
  // The printer model the P1S checks for (C12).
  assert.match(new TextDecoder().decode(files.get("Metadata/slice_info.config")), /key="printer_model_id" value="C12"/);
  // The smooth plate's file has no trim and its own key.
  const smooth = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "smooth");
  const smoothFiles = storedZip(smooth.package);
  assert.match(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.json")), /"bed_type":"hot_plate"/);
  assert.doesNotMatch(new TextDecoder().decode(smoothFiles.get("Metadata/plate_1.gcode")), /G29\.1 Z-0\.04/);
  // Two code paths agreeing: the same layer moves as the plain slice of the same choices; 3 walls differ, so the comparison can fail.
  const plain = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  assert.deepEqual(layerMoves(gcode), layerMoves(plain.gcode));
  const three = await sliceBodies(kernel, doc, bodyFeatures(doc), { ...PRINT_DEFAULTS, walls: 3 });
  assert.notDeepEqual(layerMoves(gcode), layerMoves(three.gcode));
  // A plate the engine doesn't know is the app's bug, refused as a bad request.
  await assert.rejects(printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "glass" as never), (e: Error & { kind?: string }) => e.kind === "bad-request" && /bad plate/.test(e.message));
  await assert.rejects(printFileOf(kernel, doc, [], PRINT_DEFAULTS, "textured"), /no body to slice/);
  // The nozzle: named where Bambu Studio's send window reads it, and its G-code dialect named, so its time reads our speed limits in mm/s (Ben's 10-31 file showed 1h32m for this cube without it).
  const settings = (p: Uint8Array) => new TextDecoder().decode(storedZip(p).get("Metadata/project_settings.config"));
  assert.match(settings(f.package), /"nozzle_volume_type": \["Standard"\]/);
  assert.match(settings(f.package), /"gcode_flavor": "marlin"/);
  const hf = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured", "high-flow");
  assert.match(settings(hf.package), /"nozzle_volume_type": \["High Flow"\]/);
  assert.match(new TextDecoder().decode(storedZip(hf.package).get("Metadata/slice_info.config")), /key="nozzle_volume_type" value="1"/);
  // Only what the file says changes, not one move.
  assert.deepEqual(layerMoves(new TextDecoder().decode(storedZip(hf.package).get("Metadata/plate_1.gcode"))), layerMoves(gcode));
  await assert.rejects(printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured", "hardened" as never), (e: Error & { kind?: string }) => e.kind === "bad-request" && /bad nozzle/.test(e.message));
});

// ---- Slicer hunt 2026-10-31: the dialog's follow-ups ----

test("a refusal is put in words a beginner can act on, worked by hand", () => {
  // Runs from x = -22 to 278: 278 - (-22) = 300 mm; y 118 to 138: 20 mm. The wider is 300, along x: "wide".
  assert.equal(refusalWords("the part, placed at (128, 128), runs from (-22, 118) to (278, 138), off the 256 × 256 mm bed"), "The part is 300 mm wide, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.");
  // Deeper than wide: y 0 to 300.5, x 0 to 10: 300.5 deep.
  assert.equal(refusalWords("the part, placed at (128, 128), runs from (0, 0) to (10, 300.5), off the 256 × 256 mm bed"), "The part is 300.5 mm deep, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.");
  assert.equal(refusalWords("layer 1280 reaches z = 256.2 mm, above the printer's 256 mm"), "The part is about 256.2 mm tall, and the P1S prints up to 256 mm. Make it shorter or split it into pieces.");
  // Anything else is kept.
  assert.equal(refusalWords("something else broke"), "Something else broke");
});

test("closing the dialog drops a slice still running: nothing is saved; reopened, it still says Slicing… and the buttons stay off", async () => {
  let finish!: () => void;
  let savedAfterClose = false;
  const t = dialog(
    (_c, _f, alive) =>
      new Promise((_, reject) => {
        finish = () => {
          if (alive()) savedAfterClose = true;
          reject(new SliceDropped());
        };
      }),
  );
  t.d.ask();
  t.$("slice-print-go").click();
  assert.equal(t.$<HTMLButtonElement>("slice-print-preview").disabled, true, "Preview is off while Slice and download runs");
  t.$("slice-print-close").click();
  t.d.ask();
  assert.equal(t.$("slice-print-status").textContent, "Slicing…", "reopened mid-slice it still says so");
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, true);
  finish();
  await t.settle();
  assert.equal(savedAfterClose, false, "the dialog was closed since the click: alive() is false");
  assert.equal(t.$("slice-print-status").textContent, "", "a dropped slice says nothing");
  assert.equal(t.$<HTMLButtonElement>("slice-print-go").disabled, false);
  assert.equal(t.$<HTMLButtonElement>("slice-print-preview").disabled, false);
  await t.window.happyDOM.close();
});

test("a slice with the dialog left open is alive when it ends (the other side of the check)", async () => {
  let aliveAtEnd: boolean | null = null;
  const t = dialog(async (_c, _f, alive) => ((aliveAtEnd = alive()), { print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.equal(aliveAtEnd, true);
  await t.window.happyDOM.close();
});

test("changing a choice clears the last result, which no longer matches", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.match(t.$("slice-print-status").textContent!, /^Saved /);
  const infill = t.$<HTMLSelectElement>("slice-print-infill");
  infill.value = "25";
  infill.dispatchEvent(new t.window.Event("change") as unknown as Event);
  assert.equal(t.$("slice-print-status").textContent, "");
  await t.window.happyDOM.close();
});

test("Preview is given the file choices, so it can slice the file that is downloaded", async () => {
  const t = dialog(async () => ({ print: print(), saved: true }));
  t.d.ask();
  t.$("slice-print-preview").click();
  await t.settle();
  assert.deepEqual(t.files, [{ format: "p1s", plate: "textured", nozzle: "standard" }]);
  await t.window.happyDOM.close();
});

test("the G-code inside a P1S print file is the plate's, read back from the package; bytes that are no such package give null", async () => {
  const doc = partDocument("box", 20, 20, 20);
  const f = await printFileOf(nodeKernel(), doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  const gcode = gcodeOfPackage(f.package)!;
  assert.ok(gcode, "found");
  // By hand: the file marks each of 20 mm / 0.2 mm = 100 layers; the md5 beside it is that text's.
  assert.equal((gcode.match(/^;LAYER_CHANGE$/gm) ?? []).length, 100);
  const md5 = createHash("md5").update(gcode).digest("hex").toUpperCase();
  assert.ok(new TextDecoder().decode(f.package).includes(md5), "the md5 file in the package is this text's");
  assert.equal(gcodeOfPackage(new Uint8Array([1, 2, 3])), null);
  assert.equal(gcodeOfPackage(new Uint8Array(0)), null);
  assert.equal(gcodeOfPackage(f.package.subarray(0, 200)), null, "cut short");
});

test("the preview reads a P1S file's layer moves only: 100 layers for the 20 mm cube, as the plain slice, where the whole file reads 99", async () => {
  const doc = partDocument("box", 20, 20, 20);
  const kernel = nodeKernel();
  const f = await printFileOf(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS, "textured");
  const whole = gcodeOfPackage(f.package)!;
  const moves = printMovesOf(whole)!;
  // By hand: 20 mm / 0.2 mm = 100 layers, the same as the plain slice's replay.
  assert.equal(playback(moves).layers.length, 100);
  // By hand: the first layer is 0.2 mm up and the last 20 mm; the lift before layer 1 is kept (else layer 1 reads 0.00 mm).
  assert.equal(playback(moves).layers[0].z, 0.2);
  assert.equal(playback(moves).layers[99].z, 20);
  assert.equal(playback(moves).layers.length, playback((await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS)).gcode).layers.length);
  assert.equal(playback(whole).layers.length, 99, "the start routine's own plastic confuses the layers (why it is cut off)");
  assert.ok(!moves.includes(";===== end"), "the end routine is cut off");
  assert.equal(printMovesOf("no layers here"), null);
});

test("a file's name starts with the project's name, so files of two projects differ on the printer's list; an unnamed project keeps 'spindlelabs'", () => {
  // By hand: name, then the layer height, walls and infill, then the plate and the ending.
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "standard", "Bracket"), "Bracket-0.2mm-2w-15pc-textured.gcode.3mf");
  assert.equal(printFileName(PRINT_DEFAULTS, "textured", "high-flow", "Bracket"), "Bracket-0.2mm-2w-15pc-textured-high-flow.gcode.3mf");
  assert.equal(gcodeName({ ...PRINT_DEFAULTS, supports: "tree" }, "Bracket"), "Bracket-0.2mm-2w-15pc-tree-supports.gcode");
  for (const unnamed of [undefined, "", "   ", "Untitled", "untitled"]) assert.equal(printFileName(PRINT_DEFAULTS, "smooth", "standard", unnamed), "spindlelabs-0.2mm-2w-15pc-smooth.gcode.3mf", String(unnamed));
  assert.notEqual(printFileName(PRINT_DEFAULTS, "textured", "standard", "A"), printFileName(PRINT_DEFAULTS, "textured", "standard", "B"));
});

/** A binary STL of triangles given by their corners' z (the x and y are 0: only z is read). */
const stlOfZ = (triangles: number[][]): Uint8Array => {
  const out = new Uint8Array(84 + 50 * triangles.length);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => t.forEach((z, c) => view.setFloat32(84 + i * 50 + 12 + c * 12 + 8, z, true)));
  return out;
};

test("the lowest z of a binary STL, worked by hand; no triangle gives NaN", () => {
  // Corners' z: (5, 3, 4) and (7, -2, 9): the smallest of all six is -2.
  assert.equal(stlLowestZ(stlOfZ([[5, 3, 4], [7, -2, 9]])), -2);
  assert.ok(Number.isNaN(stlLowestZ(stlOfZ([]))));
  assert.ok(Number.isNaN(stlLowestZ(new Uint8Array(10)))); // shorter than a header
  // A count larger than the bytes held reads only the triangles there are (one of them), never past the end.
  const lying = stlOfZ([[1, 2, 3]]);
  new DataView(lying.buffer).setUint32(80, 1_000_000, true);
  assert.equal(stlLowestZ(lying), 1);
});

test("bodies at different heights get one sentence naming the first one above the lowest; level ones, one body, or nothing known get none", () => {
  // Lowest points 0, 20 and -3: the floor is -3, so the first above it by more than 0.01 is body 1 (0 - (-3) = 3 mm).
  assert.equal(levelNote([0, 20, -3]), "Body 1 starts 3 mm above the lowest body. The lowest point goes on the plate, so it hangs in the air and only prints with supports on: set the bodies on one level to print them together.");
  // 0 and 20: the floor is 0, body 2 is 20 mm above.
  assert.match(levelNote([0, 20]), /^Body 2 starts 20 mm above the lowest body\./);
  // 0.9× and 1.1× of the 0.01 mm tolerance: 0.009 is level, 0.011 is not.
  assert.equal(levelNote([0, 0.009]), "");
  assert.match(levelNote([0, 0.011]), /^Body 2 starts 0 mm above/);
  assert.equal(levelNote([5]), "");
  assert.equal(levelNote([]), "");
  assert.equal(levelNote([0, Number.NaN]), "");
});

test("on the real kernel: a cube beside one 20 mm up is noted, two on the floor are not", async () => {
  const kernel = nodeKernel();
  const cube = (z: number) => kernel.call("export_stl", { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [0, 0, z] }] } }, "body");
  const low = stlLowestZ((await cube(0)).bytes);
  const up = stlLowestZ((await cube(20)).bytes);
  assert.equal(low, 0);
  assert.equal(up, 20);
  assert.match(levelNote([low, up]), /^Body 2 starts 20 mm above/);
  assert.equal(levelNote([low, low]), "");
});

test("the dialog adds the heights note after the result and marks it as a warning; without it the result is plain", async () => {
  let note = "Body 2 starts 20 mm above the lowest body.";
  const t = dialog(async () => ({ print: { ...print(), levelNote: note }, saved: true }));
  t.d.ask();
  t.$("slice-print-go").click();
  await t.settle();
  assert.match(t.$("slice-print-status").textContent ?? "", /plus heating and levelling\)\. Body 2 starts 20 mm above the lowest body\.$/);
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), true);
  note = "";
  t.$("slice-print-go").click();
  await t.settle();
  assert.doesNotMatch(t.$("slice-print-status").textContent ?? "", /Body 2/);
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), false);
});

test("a body floating above the plate is refused with advice when supports are off, and sliced with supports on (real kernel)", async () => {
  const kernel = nodeKernel();
  const cube = (x: number, z: number) => kernel.call("export_stl", { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [x, 0, z] }] } }, "body");
  // One cube on the plate at x 0, one 20 mm up at x 30: its centre is (35, 5) once the lowest point is on the plate.
  const stl = stackStl([(await cube(0, 0)).bytes, (await cube(30, 20)).bytes]);
  const words = (m: string) => refusalWords(m);
  await assert.rejects(kernel.call("slice_stl", stl, 0.2, 2, 15, "off"), (e: Error) => {
    assert.equal(words(e.message), "Part of the model hangs in the air 20 mm above the plate, around (35, 5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.");
    return true;
  });
  assert.ok((await kernel.call("slice_stl", stl, 0.2, 2, 15, "normal")).layers > 0);
  // The wording by hand, for a message of the same shape.
  assert.equal(refusalWords("part of the model starts in mid-air at z = 3.5 mm, around (-2, 7.5), with nothing under it: turn on supports"), "Part of the model hangs in the air 3.5 mm above the plate, around (-2, 7.5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.");
});
