// Slice for printing (slice-print.ts): the files handed to the engine, the
// words a slice is described in (worked by hand), the dialog in a real DOM
// (happy-dom) with a stand-in slicer, and a real slice of a 20 mm cube on
// the shipped kernel build. The Chromium check is apps/fission/e2e/slice-print.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SlicedPrint } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { gcodeName, PRINT_DEFAULTS, printWords, sliceBodies, slicePrint, stackStl, unprintedWords, type PrintChoices } from "../src/slice-print.ts";

const print = (over: Partial<SlicedPrint> = {}): SlicedPrint => ({ gcode: "G1 X1\n", layers: 100, filamentMm: 1730, filamentG: 5.16, retractions: 0, unprintedVolume: 0, preview: [], ...over });

test("the bodies' files go to the engine back to back, each whole", () => {
  // [1, 2] then [3] then nothing then [4, 5]: 1, 2, 3, 4, 5 in that order.
  assert.deepEqual([...stackStl([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([]), new Uint8Array([4, 5])])], [1, 2, 3, 4, 5]);
  assert.equal(stackStl([]).length, 0);
});

test("a slice in words, worked by hand", () => {
  // 1730 mm is 1.73 m; 5.16 g is under 10, so to one decimal: 5.2 g.
  assert.equal(printWords(print()), "100 layers, 5.2 g of PLA (1.73 m of filament).");
  // 12.6 g is 10 or more, so a whole number: 13 g. One layer is "layer".
  assert.equal(printWords(print({ layers: 1, filamentG: 12.6, filamentMm: 4220 })), "1 layer, 13 g of PLA (4.22 m of filament).");
  assert.equal(gcodeName({ layerHeight: 0.16, walls: 3, infill: 20 }), "spindlelabs-0.16mm-3w-20pc.gcode");
  // The P1S's defaults, the engine's own: 0.2 mm layers, 2 walls, 15 %.
  assert.deepEqual(PRINT_DEFAULTS, { layerHeight: 0.2, walls: 2, infill: 15 });
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

function dialog(slice: (c: PrintChoices) => Promise<{ print: SlicedPrint; saved: boolean }>) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const keys: string[] = [];
  doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  const asked: PrintChoices[] = [];
  const d = slicePrint(slot, { slice: (c) => (asked.push(c), slice(c)) });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { d, doc, keys, asked, $, settle, window };
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
  t.$<HTMLSelectElement>("slice-print-quality").value = "0.16";
  t.$<HTMLSelectElement>("slice-print-walls").value = "3";
  t.$<HTMLSelectElement>("slice-print-infill").value = "40";
  t.$("slice-print-go").click();
  await t.settle();
  assert.deepEqual(t.asked, [{ layerHeight: 0.16, walls: 3, infill: 40 }]);
  assert.equal(t.$("slice-print-status").textContent, "Saved spindlelabs-0.16mm-3w-40pc.gcode: 100 layers, 5.2 g of PLA (1.73 m of filament).");
  assert.equal(t.$("slice-print-status").classList.contains("slice-print-bad"), false);
  t.$("slice-print-close").click();
  assert.equal(t.d.open, false);
  await t.window.happyDOM.close();
});

test("the dialog says a refusal in the engine's words, warns about plastic left out, and keeps its keys", async () => {
  let answer: () => Promise<{ print: SlicedPrint; saved: boolean }> = async () => {
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
  assert.equal(t.$("slice-print-status").textContent, "Sliced, but not saved: 100 layers, 5.2 g of PLA (1.73 m of filament). Some of the part is thinner than one printed line, so about 2.00 mm³ of it won't print.");
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
