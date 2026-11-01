// Regression tests for the typed-sizes hunt of 2026-11-01, in the real
// workspace on the real kernel (packages/testing/journeys/design-app.ts):
// - a second Enter in the typed boxes, nothing typed and the pointer not
//   moved since the first placed its point, placed a stray line to where
//   the pointer had been before the typed point;
// - the grid size went back to 10 mm each time a sketch was opened again;
// - a refused grid size stayed in the box while the old grid stayed in use;
// - a grid of 1e300 was answered with the kernel's 356-character refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../src/document.ts";
import { DEFAULT_GRID } from "../src/sketch-tool.ts";
import { app } from "../../../packages/testing/journeys/design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

/** A box on the 40 × 30 × 20 part and a new sketch on the ground plane, open. */
async function sketching(): Promise<App> {
  const a = await app(partDocument("box", 40, 30, 20));
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  assert.equal(a.sketching(), true);
  return a;
}

const input = (a: App, id: string) => a.$(id) as unknown as HTMLInputElement;
/** Types `text` into a typed-size box, as a person does (its input event). */
function type(a: App, field: string, text: string) {
  const box = input(a, `#typed-${field}`);
  box.focus();
  box.value = text;
  box.dispatchEvent(new a.window.Event("input") as unknown as Event);
}
/** Enter in the box that has the keys. */
async function enter(a: App) {
  const box = a.window.document.activeElement as unknown as HTMLElement;
  assert.ok(box?.id?.startsWith("typed-"), `the keys are in a typed box, not ${box?.id}`);
  box.dispatchEvent(new a.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
  await a.settle();
}
/** A grid size typed in the sketch panel and confirmed (its change event). */
async function grid(a: App, text: string) {
  const box = input(a, "#sketch-grid");
  box.value = text;
  box.dispatchEvent(new a.window.Event("change") as unknown as Event);
  await a.settle();
}
const points = (a: App) => a.doc().sketches[0].points.map((p) => [p.x, p.y]);
const gridError = (a: App) => (a.$("#sketch-grid-error")!.hidden ? "" : a.$("#sketch-grid-error")!.textContent ?? "");

test("regression: a second Enter with nothing typed and the pointer still places nothing; after a real move it places as a click", async () => {
  const a = await sketching();
  await a.click(0, 0);
  a.pointer("move", [20, 7]);
  await a.settle();
  type(a, "length", "10");
  type(a, "angle", "0");
  await enter(a);
  // By hand: 10 mm at 0° from (0, 0) is (10, 0) exactly (direction(0) is (1, 0)).
  assert.deepEqual(points(a), [[0, 0], [10, 0]]);
  // Enter again at once: nothing is typed and the pointer has not moved. It drew a line from (10, 0) to (20, 7), where
  // the pointer was before the typed point; nothing is drawn now.
  await enter(a);
  assert.deepEqual(points(a), [[0, 0], [10, 0]], "the second Enter drew a stray line");
  assert.equal(a.doc().sketches[0].curves.length, 1);
  // A real move, then Enter with the boxes empty: placed where the pointer is, as a click there would. (10, 5) is 5 mm
  // from (10, 0), outside the 1 mm snap reach of a 0.1 mm pixel, and on a 0.1 mm step, so the free rounding keeps it.
  a.pointer("move", [10, 5]);
  await a.settle();
  await enter(a);
  assert.deepEqual(points(a), [[0, 0], [10, 0], [10, 5]]);
  assert.equal(a.doc().sketches[0].curves.length, 2);
  assert.ok(await a.close());
});

test("regression: a sketch opened again keeps the grid size it was given this session; a new sketch starts at the default", async () => {
  const a = await sketching();
  const id = a.doc().sketches[0].id;
  assert.equal(input(a, "#sketch-grid").value, String(DEFAULT_GRID));
  await grid(a, "2");
  await a.finish();
  await a.doubleClick(id);
  assert.equal(a.sketching(), true);
  assert.equal(input(a, "#sketch-grid").value, "2", "the grid went back to the default");
  // The grid in use is 2 mm too, not just the text: with Snap to grid ticked a click at (2.9, 3.2) lands on (2, 4), the
  // nearest multiples of 2 (2.9 is 0.9 from 2 and 1.1 from 4; 3.2 is 0.8 from 4 and 1.2 from 2).
  const snap = input(a, "#sketch-grid-snap");
  snap.checked = true;
  snap.dispatchEvent(new a.window.Event("change") as unknown as Event);
  await a.settle();
  await a.click(2.9, 3.2);
  await a.click(20, 20);
  assert.deepEqual(points(a).slice(-2), [[2, 4], [20, 20]]);
  await a.key("clear-selection");
  await a.finish();
  // A new sketch: its own grid, the default.
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XZ" });
  assert.equal(input(a, "#sketch-grid").value, String(DEFAULT_GRID));
  assert.ok(await a.close());
});

test("regression: a refused grid size puts the last good one back in the box and says the old grid is still in use", async () => {
  const a = await sketching();
  await grid(a, "2");
  await grid(a, "-5");
  assert.equal(input(a, "#sketch-grid").value, "2", "the refused -5 stayed in the box");
  // The reason, and that the grid in use is still 2 mm.
  assert.match(gridError(a), /more than 0 mm/);
  assert.match(gridError(a), /The grid stays at 2 mm\.$/);
  // Nothing typed (a number box the browser could not read gives ""): the same.
  await grid(a, "");
  assert.equal(input(a, "#sketch-grid").value, "2");
  assert.match(gridError(a), /^Type the grid size in mm\. The grid stays at 2 mm\.$/);
  // A good size clears the message.
  await grid(a, "5");
  assert.equal(gridError(a), "");
  assert.equal(input(a, "#sketch-grid").value, "5");
  assert.ok(await a.close());
});

test("grid limits checked before the kernel is asked, in plain words: 0.9× and 1.1× of 0.001 mm and of 1,000,000 mm, and 1e300", async () => {
  const a = await sketching();
  const asks = async (text: string) => {
    const before = a.calls().made;
    await grid(a, text);
    return a.calls().made - before;
  };
  // 0.0009 = 0.9 × 0.001: under the smallest piece; refused without a kernel call.
  assert.equal(await asks("0.0009"), 0, "0.0009 went to the kernel");
  assert.equal(gridError(a), "The grid size must be at least 0.001 mm, the smallest piece the modeller keeps. The grid stays at 10 mm.");
  assert.equal(input(a, "#sketch-grid").value, "10");
  // 0.0011 = 1.1 × 0.001: taken (the kernel asked once, to check it).
  assert.equal(await asks("0.0011"), 1);
  assert.equal(gridError(a), "");
  assert.equal(input(a, "#sketch-grid").value, "0.0011");
  // 900000 = 0.9 × 1e6: taken.
  await asks("900000");
  assert.equal(gridError(a), "");
  // 1100000 = 1.1 × 1e6: over the largest size; refused without a kernel call, the last good 900000 back.
  assert.equal(await asks("1100000"), 0);
  assert.equal(gridError(a), "The grid size can be at most 1000000 mm (1 km), the largest size the modeller works at. The grid stays at 900000 mm.");
  assert.equal(input(a, "#sketch-grid").value, "900000");
  // 1e300: the same short words, not the kernel's refusal with all 301 digits.
  assert.equal(await asks("1e300"), 0);
  assert.ok(gridError(a).length < 120, `${gridError(a).length} characters: ${gridError(a)}`);
  assert.ok(await a.close());
});
