// Shapes and selection bug hunt (2026-11-01): hand-worked cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "./design-app.ts";
import { empty, insert, type, row, panel } from "./selection-hunt-helpers.ts";
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, want), `${what}: ${got}, expected ${want}`);

test("hand-worked panel figures for each inserted primitive", async () => {
  const a = await app(empty());
  await insert(a, "box");
  // 40·30·20 = 24000; area 2(40·30 + 40·20 + 30·20) = 2(1200+800+600) = 5200
  near(panel(a).volume, 24000, "box volume");
  near(panel(a).area, 5200, "box area");
  await insert(a, "cylinder");
  // r 20, h 20: πr²h = 8000π; area 2πr² + 2πrh = 800π + 800π = 1600π
  assert.equal(panel(a).heading, "Body 2");
  near(panel(a).volume, Math.round(8000 * Math.PI * 1e5) / 1e5, "cylinder volume");
  await insert(a, "sphere");
  // ⌀40: 4/3 π 20³ = 32000π/3; area 4π·400 = 1600π
  near(panel(a).volume, Math.round((32000 * Math.PI / 3) * 1e5) / 1e5, "sphere volume");
  assert.ok(await a.close());
});

test("selecting Body 1 among two: the panel describes Body 1", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "cylinder");
  await row(a, "body-1");
  const p = panel(a);
  assert.equal(p.heading, "Body 1");
  near(p.volume, 24000, "Body 1 volume");
  assert.ok(await a.close());
});

test("Body 1 selected, width typed: the panel's figures still match what it names", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "box");
  await row(a, "body-1");
  assert.equal((a.$("#width") as HTMLInputElement).value, "40");
  await type(a, "width", "50");
  const p = panel(a);
  const f = a.doc().timeline.features;
  console.log("after typing, features", f.map((x) => `${x.id} ${x.intent.summary}`), "panel", p, "sel", a.selection.items.map((i) => i.id));
  // Whatever it changed, the panel must name the body whose numbers it shows: Body 1 still 24000, or Body 2 at 50·30·20 = 30000.
  const expected = p.heading === "Body 1" ? (f[0].intent.parameters.width as number) * 600 : (f[1].intent.parameters.width as number) * 600;
  near(p.volume, expected, `${p.heading} volume`);
  assert.ok(await a.close());
});

test("delete the selected body: selection empty, panel on the remaining part", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "cylinder");
  await row(a, "body-2");
  assert.equal(await a.menu("feature-2", "delete"), null);
  await a.settle();
  const dlg = a.$("#delete-ask-confirm") ?? a.window.document.querySelector("dialog button.danger");
  if (dlg) { (dlg as HTMLElement).click(); await a.settle(); }
  assert.deepEqual(a.doc().timeline.features.map((x) => x.id), ["feature-1"]);
  assert.deepEqual(a.selection.items.map((i) => i.id), [], "nothing selected");
  const p = panel(a);
  assert.equal(p.heading, "Body 1");
  near(p.volume, 24000, "the box");
  // Undo brings it back; redo deletes again
  await a.undo();
  assert.equal(a.doc().timeline.features.length, 2);
  console.log("after undo sel", a.selection.items.map((i) => i.id), panel(a));
  await a.redo();
  assert.deepEqual(a.selection.items.map((i) => i.id), [], "nothing selected after redo");
  near(panel(a).volume, 24000, "box after redo");
  assert.ok(await a.close());
});

test("undo of an insert while it is selected", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "sphere");
  await row(a, "body-2");
  assert.equal(await a.undo(), "Insert Sphere");
  assert.deepEqual(a.selection.items.map((i) => i.id), [], "the sphere's gone, nothing selected");
  const p = panel(a);
  assert.equal(p.heading, "Body 1");
  near(p.volume, 24000, "the box");
  assert.equal((a.$("#shape") as HTMLSelectElement).value, "box");
  assert.equal((a.$("#width") as HTMLInputElement).value, "40");
  await a.redo();
  near(panel(a).volume, Math.round((32000 * Math.PI / 3) * 1e5) / 1e5, "sphere back");
  assert.ok(await a.close());
});

test("suppress the selected body: it no longer shows its numbers as live", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "cylinder");
  await row(a, "body-2");
  assert.equal(await a.menu("feature-2", "suppress"), null);
  const p = panel(a);
  console.log("after suppress", p, a.selection.items.map((i) => i.id), a.note());
  assert.notEqual(p.heading, "Body 2", "a suppressed body has no figures");
  near(p.volume === 0 ? 24000 : p.volume, 24000, "panel shows Body 1 or nothing");
  assert.ok(await a.close());
});

test("size boxes: limits at 0.9x/1.1x", async () => {
  const a = await app(empty());
  await insert(a, "box");
  const cases: [string, boolean][] = [["0.0009", false], ["0.0011", true], ["900000", true], ["1100000", false], ["2000000", false], ["", false], ["0", false], ["-5", false], ["abc", false], ["1e-4", false], ["Infinity", false], ["0.0001", false]];
  for (const [v, ok] of cases) {
    await type(a, "width", "40");
    const before = a.doc();
    await type(a, "width", v);
    const took = a.doc() !== before;
    assert.equal(took, ok, `width ${JSON.stringify(v)} taken=${took}, error ${panel(a).error}`);
    if (!ok) assert.ok(panel(a).error !== "", `width ${v} says why`);
    await type(a, "width", v, true);
    if (!ok) assert.equal((a.$("#width") as HTMLInputElement).value, "40", `left with ${v}: back to 40`);
  }
  assert.ok(await a.close());
});

test("box changed to sphere through the Shape choice rests on the floor; sphere made bigger goes below and stays", async () => {
  const a = await app(empty());
  await insert(a, "box");
  const sel = a.$("#shape") as HTMLSelectElement;
  sel.value = "sphere";
  sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event);
  await a.settle();
  const zs = () => { const p = a.mesh()!.positions; let lo = Infinity, hi = -Infinity; for (let i = 2; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return [lo, hi]; };
  // ⌀40 → z 0..40
  let [lo, hi] = zs();
  assert.ok(Math.abs(lo) < 1e-3 && Math.abs(hi - 40) < 1e-3, `sphere z ${lo}..${hi}`);
  await type(a, "width", "60");
  [lo, hi] = zs();
  // centre 20, r 30: −10..50
  assert.ok(Math.abs(lo + 10) < 1e-3 && Math.abs(hi - 50) < 1e-3, `bigger sphere z ${lo}..${hi}`);
  // to a box and back to a sphere: lifted afresh, ⌀60 → 0..60
  sel.value = "box"; sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event); await a.settle();
  [lo, hi] = zs();
  assert.ok(Math.abs(lo) < 1e-3, `box from sphere bottom ${lo}`);
  sel.value = "sphere"; sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event); await a.settle();
  [lo, hi] = zs();
  assert.ok(Math.abs(lo) < 1e-3 && Math.abs(hi - 60) < 1e-3, `sphere again z ${lo}..${hi}`);
  assert.ok(await a.close());
});

test("ghost: after undoing an insert, the deleted body's id comes back on a different new body, still selected", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "sphere");
  await row(a, "body-2"); // the sphere
  await a.undo(); // "Insert Sphere" undone: no Body 2 any more
  assert.deepEqual(a.selection.items.map((i) => i.id), [], "the undone sphere is not still selected");
  assert.ok(await a.close());
});

test("ghost: the stale selection lands on a box the user never selected", async () => {
  const a = await app(empty());
  await insert(a, "box");
  await insert(a, "sphere");
  await row(a, "body-2");
  await a.undo();
  await a.menu("feature-1", "suppress"); // no body builds now
  await type(a, "width", "50"); // a size typed with no part adds a new box at the marker (withPart)
  // A new box was made and nobody selected it: the panel should not call it the selection.
  assert.equal(a.$("#selection-list")!.textContent, "", `selection list: ${a.$("#selection-list")!.textContent}`);
  assert.ok(await a.close());
});
