// Slice for printing (slice-print.ts): the files handed to the engine, the
// words a slice is described in (worked by hand), the dialog in a real DOM
// (happy-dom) with a stand-in slicer, and real slices on the shipped kernel build (a 20 mm cube; supports under a plate on a column;
// the cube's P1S print file, unpacked by the test's own reader).
// The Chromium checks are apps/fission/e2e/slice-print.mjs and print-preview.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SlicedPrint } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { createHash } from "node:crypto";
import { FILE_DEFAULTS, gcodeName, NOZZLE_KEY, PRINT_DEFAULTS, rememberedNozzle, printFileName, printFileOf, printWords, sliceBodies, slicePrint, stackStl, timeWords, unprintedWords, type FileChoices, type PrintChoices, type PrintFacts } from "../src/slice-print.ts";

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

function dialog(slice: (c: PrintChoices, f: FileChoices) => Promise<{ print: PrintFacts; saved: boolean; name?: string }>, preview: (c: PrintChoices) => Promise<void> = async () => {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const keys: string[] = [];
  doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  const asked: PrintChoices[] = [];
  const files: FileChoices[] = [];
  const d = slicePrint(slot, {
    slice: async (c, f) => {
      asked.push(c);
      files.push(f);
      const r = await slice(c, f);
      return { ...r, name: r.name ?? nameFor(c, f) };
    },
    preview: (c) => (asked.push(c), preview(c)),
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
  assert.equal(t.$("slice-print-status").textContent, "the part is bigger than the printer's bed");
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
  // The engine's moves-only time for this cube at the defaults is 257 s (the engine's own tests check it against its moves); here, that it reaches the app.
  assert.equal(timeWords(p.printTimeS), "4 min", `time ${p.printTimeS}`);
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
  const doc = insertMove(plate.doc, [plate.id], { ...NO_MOVE, z: 10 }).doc;
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
