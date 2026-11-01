// Journey: the Parameters' size boxes and Shape choice describe and edit
// the body the Feature and Body sections describe (bug fix, Move/timeline
// bug hunt 2026-11-01: with two bodies and Body 1 selected, the panel named
// Body 1 but the Width box showed the last body's width, and typing in it
// changed the last body). The boxes follow the selected body (`panelFocus`,
// the same rule the Feature section uses), and the last body when nothing
// is selected, as before. The assistant's set_part still changes the last
// body, which is what it is told it changes (ai-view.ts), keeping that
// body's own sizes for any it leaves out. Hand-worked cases first, then
// seeded random designs against a plain list of each body's sizes. On the
// real WASM kernel, in the real workspace (design-app.ts). Run with
// `npm run journeys` after the app build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, insertPreset, type DesignDocument } from "@fission/design";
import { seeded } from "../src/index.ts";
import { app, chooseShape } from "./design-app.ts";

type A = Awaited<ReturnType<typeof app>>;
const empty = (): DesignDocument => ({ version: 6, nextId: 1, profiles: [], sketches: [], timeline: { features: [] }, bodies: [], nextBody: 1 }) as DesignDocument;

/** Insert ▾ then a shape, as a person does: a new body at 40 × 30 × 20 (insert.ts INSERT_SIZES). */
async function insert(a: A, kind: string) {
  (a.$("#insert") as HTMLButtonElement).click();
  await a.settle();
  (a.$(`#insert-${kind}`) as HTMLButtonElement).click();
  await a.settle();
}
/** Types `v` into size box `key`; `leave` then leaves the box (change). */
async function type(a: A, key: string, v: string, leave = false) {
  const el = a.$(`#${key}`) as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.settle();
  if (leave) {
    el.dispatchEvent(new a.window.Event("change") as unknown as Event);
    await a.settle();
  }
}
/** A click on the browser row `node` ("body-1"). */
async function row(a: A, node: string) {
  const r = [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((x) => x.dataset.node === node);
  assert.ok(r, `there is a row ${node}`);
  r.click();
  await a.settle();
}
const box = (a: A, key: string) => (a.$(`#${key}`) as HTMLInputElement).value;
const shown = (a: A, key: string) => a.$(`#${key}-row`)!.hidden === false;
const choice = (a: A) => (a.$("#shape") as HTMLSelectElement).value;
const intent = (a: A) => a.$("#intent")!.textContent;
const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.\-]/g, ""));
const volume = (a: A) => num(a.$("#volume")!.textContent);
const params = (a: A) => a.doc().timeline.features.map((f) => f.intent.parameters);

test("Body 1 selected: the size boxes are Body 1's, and typing changes Body 1 only", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await type(a, "width", "60"); // Box 2: 60 × 30 × 20
  assert.equal(box(a, "width"), "60");
  await row(a, "body-1");
  // The panel names Box 1, 40 × 30 × 20: volume 40·30·20 = 24000 mm³.
  assert.equal(intent(a), "Box: 40 × 30 × 20 mm");
  assert.ok(Math.abs(volume(a) - 24000) < 1, `Body 1's volume, ${volume(a)}`);
  // So the boxes beside it read Body 1's 40 × 30 × 20, not Body 2's 60.
  assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], ["40", "30", "20"]);
  assert.equal(choice(a), "box");
  await type(a, "width", "50");
  // Typed with Body 1 shown: Body 1 is 50 wide, 50·30·20 = 30000 mm³; Body 2 keeps 60.
  assert.deepEqual(params(a).map((p) => p.width), [50, 60], "the selected body changed, not the other");
  assert.equal(intent(a), "Box: 50 × 30 × 20 mm");
  assert.ok(Math.abs(volume(a) - 30000) < 1, `Body 1's new volume, ${volume(a)}`);
  // Nothing selected: the boxes are the last body's again (60), as before the fix.
  a.selection.clear();
  await a.settle();
  assert.equal(box(a, "width"), "60");
  assert.equal(intent(a), "Box: 60 × 30 × 20 mm");
  // Typing now changes the last body, Body 1 keeps its 50.
  await type(a, "height", "25");
  assert.deepEqual(params(a).map((p) => [p.width, p.height]), [[50, 20], [60, 25]]);
  assert.ok(await a.close());
});

test("Body 1 selected, the Shape choice made a cylinder: Body 1 turns, Body 2 stays a box", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await type(a, "depth", "35"); // Box 2: 40 × 35 × 20
  await row(a, "body-1");
  chooseShape(a, "Cylinder");
  await a.settle();
  const types = a.doc().timeline.features.map((f) => f.intent.type);
  assert.deepEqual(types, ["cylinder", "box"], "the selected body became the cylinder");
  // A cylinder takes the boxes' width as its diameter (40) and their height (20): Body 1's own, not Body 2's.
  assert.deepEqual([params(a)[0].diameter, params(a)[0].height], [40, 20]);
  assert.deepEqual([params(a)[1].width, params(a)[1].depth, params(a)[1].height], [40, 35, 20], "Body 2 untouched");
  // The panel still describes Body 1, now a cylinder: the depth box is hidden, π·20²·20 = 25132.7 mm³.
  assert.equal(choice(a), "cylinder");
  assert.equal(shown(a, "depth"), false);
  assert.ok(Math.abs(volume(a) - Math.PI * 400 * 20) < 1, `the cylinder's volume, ${volume(a)}`);
  // Body 2 selected: its box and its depth of 35 come back.
  await row(a, "body-2");
  assert.equal(choice(a), "box");
  assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], ["40", "35", "20"]);
  assert.ok(await a.close());
});

test("a refused size typed for Body 1 goes back to Body 1's size when the box is left", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await type(a, "width", "60");
  await row(a, "body-1");
  await type(a, "width", "-5", true);
  // -5 is refused (no size is 0 or less), and leaving the box puts back Body 1's 40, never Body 2's 60.
  assert.equal(box(a, "width"), "40");
  assert.deepEqual(params(a).map((p) => p.width), [40, 60]);
  assert.ok(await a.close());
});

test("Undo after typing for Body 1 puts Body 1 back, and the boxes say so", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await type(a, "width", "60");
  await row(a, "body-1");
  await type(a, "width", "45");
  assert.deepEqual(params(a).map((p) => p.width), [45, 60]);
  assert.equal(await a.undo(), "Change width");
  assert.deepEqual(params(a).map((p) => p.width), [40, 60]);
  // The selection lasts through Undo (the shell's), so the boxes show Body 1's 40 again.
  assert.equal(intent(a), "Box: 40 × 30 × 20 mm");
  assert.equal(box(a, "width"), "40");
  await a.redo();
  assert.equal(box(a, "width"), "45");
  assert.ok(await a.close());
});

test("an extruded sketch selected: the height box is its distance and edits it; the box after it keeps its sizes", async () => {
  // A 10 × 10 square on XY extruded 30 (Body 1), then a box 40 × 30 × 20 (Body 2).
  let doc = empty();
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  const e = extrudeSketch(doc, s.id, 30);
  doc = insertPreset(e.doc, "box", 40, 30, 20).doc;
  const a = await app(doc);
  assert.equal(choice(a), "box");
  assert.equal(box(a, "width"), "40");
  await row(a, "body-1");
  // The extrude: only the height box shows, as its distance 30; 10·10·30 = 3000 mm³.
  assert.equal(choice(a), "sketch-extrude");
  assert.equal(shown(a, "width"), false);
  assert.equal(box(a, "height"), "30");
  assert.ok(Math.abs(volume(a) - 3000) < 1e-6 * 3000, `the extrude's volume, ${volume(a)}`);
  await type(a, "height", "15");
  const f = a.doc().timeline.features;
  assert.equal(f.find((x) => x.id === e.id)!.intent.parameters.distance, 15, "the selected extrude goes 15");
  assert.deepEqual(f.filter((x) => x.intent.type === "box").map((x) => [x.intent.parameters.width, x.intent.parameters.height]), [[40, 20]], "the box is untouched");
  assert.ok(Math.abs(volume(a) - 1500) < 1e-6 * 1500, `10·10·15 = 1500, ${volume(a)}`);
  // Back to the box: its 40 × 30 × 20, not the extrude's 15 as a height.
  await row(a, "body-2");
  assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], ["40", "30", "20"]);
  assert.ok(await a.close());
});

test("the assistant's set_part changes the last body with its own sizes, whatever is selected", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await type(a, "depth", "35"); // Box 2: 40 × 35 × 20
  await row(a, "body-1");
  assert.equal(box(a, "depth"), "30");
  // What the assistant is told it keeps: the last body's sizes (it is told set_part changes the last body).
  const keeps = a.aiView()!.keeps;
  assert.deepEqual([keeps.width, keeps.depth, keeps.height], [40, 35, 20], "the last body's sizes");
  await a.command({ op: "set_part", shape: "box", width: 70 });
  // Body 2 becomes 70 wide keeping its own depth 35 and height 20; Body 1 is untouched at 40 × 30 × 20.
  assert.deepEqual(params(a).map((p) => [p.width, p.depth, p.height]), [[40, 30, 20], [70, 35, 20]]);
  // Body 1 is still selected, so the panel and its boxes still describe Body 1.
  assert.equal(intent(a), "Box: 40 × 30 × 20 mm");
  assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], ["40", "30", "20"]);
  assert.ok(await a.close());
});

test("an extruded sketch selected, Box chosen: a new box is added, and the panel stays on the selected extrude", async () => {
  let doc = empty();
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  const e = extrudeSketch(doc, s.id, 30);
  doc = insertPreset(e.doc, "box", 40, 30, 20).doc;
  const a = await app(doc);
  await row(a, "body-1");
  assert.equal(choice(a), "sketch-extrude");
  chooseShape(a, "Box");
  await a.settle();
  // An extruded sketch has no box to become (withPart's rule, 24f4): a new box goes in at the end; the extrude keeps 30.
  const f = a.doc().timeline.features;
  assert.equal(f.filter((x) => x.intent.type === "box").length, 2, "a second box");
  assert.equal(f.find((x) => x.id === e.id)!.intent.parameters.distance, 30);
  // Nothing leaves the selection unannounced: Body 1 stays selected, so the panel and its boxes are the extrude's still.
  assert.deepEqual(a.selection.items.map((r) => r.id), [`body:${e.id}`]);
  assert.equal(choice(a), "sketch-extrude");
  assert.equal(box(a, "height"), "30");
  assert.equal(intent(a), f.find((x) => x.id === e.id)!.intent.summary);
  // Nothing selected: the new box, the last body, with its own sizes in the boxes.
  a.selection.clear();
  await a.settle();
  const made = f.at(-1)!.intent.parameters;
  assert.equal(choice(a), "box");
  assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], [made.width, made.depth, made.height].map(String));
  assert.ok(await a.close());
});

/** Seeded: random presets at random sizes, a random body selected, its boxes read and one size typed; checked against a plain list of sizes. */
for (const seed of [11n, 12n, 13n, 14n, 15n, 16n]) {
  test(`random designs, seed ${seed}: the boxes are the selected body's and edit only it`, async () => {
    const rng = seeded(seed);
    const pick = (n: number) => Math.floor(rng.next() * n);
    const count = 2 + pick(3);
    // The model: each body's width, depth and height, as typed.
    const model: [number, number, number][] = [];
    const a = await app(empty());
    for (let i = 0; i < count; i++) {
      await insert(a, "box");
      const sizes: [number, number, number] = [5 + pick(90), 5 + pick(90), 5 + pick(90)];
      for (const [k, key] of ["width", "depth", "height"].entries()) await type(a, key, String(sizes[k]));
      model.push(sizes);
    }
    for (let step = 0; step < 6; step++) {
      const i = pick(count);
      await row(a, `body-${i + 1}`);
      const [w, d, h] = model[i];
      assert.deepEqual([box(a, "width"), box(a, "depth"), box(a, "height")], [String(w), String(d), String(h)], `seed ${seed} step ${step}: Body ${i + 1}'s boxes`);
      assert.equal(intent(a), `Box: ${w} × ${d} × ${h} mm`);
      const k = pick(3);
      const v = 5 + pick(90);
      await type(a, ["width", "depth", "height"][k], String(v));
      model[i][k] = v;
      assert.deepEqual(params(a).map((p) => [p.width, p.depth, p.height]), model, `seed ${seed} step ${step}: only Body ${i + 1} changed`);
    }
    assert.ok(await a.close());
  });
}
