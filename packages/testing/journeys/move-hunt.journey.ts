// Move, Timeline and undo bug hunt (2026-11-01) regressions: an edited Move's "Centre of the bodies".
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertMove, NO_MOVE, partDocument, type MoveValues } from "@fission/design";
import { app } from "./design-app.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
type Box3 = [[number, number, number], [number, number, number]];
const meshBox = (positions: readonly number[]): Box3 => [
  [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k))) as Box3[0],
  [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k))) as Box3[1],
];
const near = (got: Box3, want: Box3, what: string) =>
  got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= 1e-5, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

test("an edited Rotate already turned about its body's centre, Centre of the bodies pressed, OK: the body stays put", async () => {
  // Box 40 × 30 × 20, centre (20, 15, 10). Rotate 1: 90° about Z through (20, 15, 10): (x, y) → (20 − (y − 15), 15 + (x − 20)):
  // x 5..35, y −5..35. Move 2 then shifts it 100 mm along X: x 105..135.
  const r = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], v({ turnZ: 90, pivotX: 20, pivotY: 15, pivotZ: 10 }), "rotate");
  const doc = insertMove(r.doc, ["body:feature-1"], v({ x: 100 })).doc;
  const a = await app(doc);
  near(meshBox(a.mesh()!.positions), [[105, -5, 0], [135, 35, 20]], "as built");
  await a.doubleClick(r.id);
  assert.equal((a.$("#move-turnZ") as HTMLInputElement).value, "90");
  // The pivot is already the centre of the body as Rotate 1 found it, so "Centre of the bodies" should change nothing.
  (a.$("#move-pivot-centre") as HTMLButtonElement).click();
  await a.settle();
  const pivot = ["X", "Y", "Z"].map((k) => (a.$(`#move-pivot${k}`) as HTMLInputElement).value);
  assert.deepEqual(pivot, ["20", "15", "10"], "the centre of the body before Rotate 1");
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  near(meshBox(a.mesh()!.positions), [[105, -5, 0], [135, 35, 20]], "after OK");
});

test("an edited Move pressed Centre of the bodies, OK: the body ends where a Move about its centre puts it", async () => {
  // As above, with OK: pivot (20, 15, 10) is the right centre, so the box stays at x 105..135, y −5..35.
  // With the pivot taken from where the body is shown (120, 15, 10): (x, y) → (120 − (y − 15), 15 + (x − 120)), then +100: x 205..235, y −105..−65.
  const r = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], v({ turnZ: 90, pivotX: 20, pivotY: 15, pivotZ: 10 }), "rotate");
  const doc = insertMove(r.doc, ["body:feature-1"], v({ x: 100 })).doc;
  const a = await app(doc);
  await a.doubleClick(r.id);
  (a.$("#move-pivot-centre") as HTMLButtonElement).click();
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  near(meshBox(a.mesh()!.positions), [[105, -5, 0], [135, 35, 20]], "after OK");
});

test("a Move holding a body deleted since: an edit can take the deleted body out, so the Move builds again", async () => {
  const { deleteItem, insertPreset } = await import("@fission/design");
  // Box 1 40 × 30 × 20 and Box 2 1 × 1 × 1, Move 1 moves both 10 mm along X; Box 2 deleted: Move 1 fails ("Box 2 was deleted").
  const m = insertMove(insertPreset(partDocument("box", 40, 30, 20), "box", 1, 1, 1).doc, ["body:feature-1", "body:feature-2"], v({ x: 10 }));
  const doc = deleteItem(m.doc, "feature-2");
  const a = await app(doc);
  await a.doubleClick(m.id);
  assert.equal(a.$("#move-panel")!.hidden, false);
  const bodies = a.$("#move-bodies")!.textContent;
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "20";
  x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.$("#move-error")!.hidden, true, `bodies line "${bodies}", error: ${a.$("#move-error")!.textContent}`);
});
