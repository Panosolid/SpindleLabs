// The design changed while the kernel worked (test-the-tests hunt,
// 2026-10-28): Design's three guards that drop an Extrude or an Edit
// feature made against a design that is no longer the one shown, in the
// Design app as the shell runs it (design-app.ts) on the real kernel, the
// kernel held to make it slow. Planting any of the guards away (an extrude
// recorded after the design changed or after Cancel, a face offered in an
// older design extruded, an edit recorded over a newer design) fails one
// of these. Run with `npm run journeys` after the app build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, CHANGED_WHILE_CHECKING, drawRectangle, partDocument, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

/** A few turns of the event loop, without waiting for the kernel (held, it answers nothing). */
const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** A 40 × 30 × 20 box (feature-1), then Sketch 1 (sketch-2): a 40 × 30 rectangle from the origin on XY. */
function boxAndSketch(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc;
}

/** Another document with the same items, as another workspace's change to the shared project gives: Design tells designs apart by the document itself, so this is a changed design. */
const changedCopy = (doc: DesignDocument): DesignDocument => ({ ...doc, timeline: { ...doc.timeline } });

async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

const ids = (doc: DesignDocument) => doc.timeline.features.map((f) => f.id);

test("Extrude OK, then the design changes before the kernel has built it: nothing is recorded", async () => {
  const a = await app(boxAndSketch());
  a.$("#extrude")!.click();
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: "sketch-2" });
  await type(a, "10");
  const before = ids(a.doc());
  a.hold();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await turns();
  const changed = changedCopy(a.doc());
  a.changeDesign(changed);
  await a.release();
  // The extrude was made from the design before the change: recording it would
  // throw the change away. So the design is the changed one, with no extrude.
  assert.equal(a.doc(), changed, "the changed design stays");
  assert.deepEqual(ids(a.doc()), before, "no extrude added");
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.ok(await a.close());
});

test("Extrude OK, then Cancel before the kernel has built it: nothing is recorded", async () => {
  const a = await app(boxAndSketch());
  a.$("#extrude")!.click();
  await a.settle();
  await a.extrudePointer({ kind: "pick", profile: "sketch-2" });
  await type(a, "10");
  const start = a.doc();
  a.hold();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await turns();
  a.$("#extrude-cancel")!.click();
  await a.release();
  assert.equal(a.doc(), start, "Cancel leaves the design as it was");
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.ok(await a.close());
});

test("a face offered in an older design: OK after the design changed records nothing", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  a.$("#extrude")!.click();
  await a.settle();
  // The box's top face, z = 20, offered for the design as it was.
  const top = a.extrudeShown()!.profiles.find((p) => p.face && p.plane.normal[2] === 1 && p.plane.origin[2] === 20);
  assert.ok(top, "the top face is offered");
  await a.extrudePointer({ kind: "pick", profile: top.id });
  await type(a, "10");
  const changed = changedCopy(a.doc());
  a.changeDesign(changed);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.doc(), changed, "the changed design stays");
  assert.deepEqual(ids(a.doc()), ["feature-1"], "no face sketch or extrude added");
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.ok(await a.close());
});

test("Edit feature OK, then the design changes while the kernel checks the sizes: the panel says so and nothing is recorded", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  await a.menu("feature-1", "edit");
  (a.$("#edit-height") as HTMLInputElement).value = "35";
  a.hold();
  a.$("#feature-edit-ok")!.click();
  await turns();
  const changed = changedCopy(a.doc());
  a.changeDesign(changed);
  await a.release();
  assert.equal(a.doc(), changed, "the changed design stays");
  assert.deepEqual(a.doc().timeline.features[0].intent.parameters, { width: 40, depth: 30, height: 20 }, "the height is still 20");
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.equal(a.$("#feature-edit")!.hidden, false, "the panel stays open");
  assert.ok(a.$("#feature-edit")!.textContent!.includes(CHANGED_WHILE_CHECKING), "and says why");
  // OK again on the design as it now is: taken, one undo step.
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.deepEqual(a.doc().timeline.features[0].intent.parameters, { width: 40, depth: 30, height: 35 });
  assert.match(a.history.undoLabel() ?? "", /^Edit /);
  assert.ok(await a.close());
});

test("Edit feature OK, then Cancel while the kernel checks: nothing is recorded", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  await a.menu("feature-1", "edit");
  (a.$("#edit-height") as HTMLInputElement).value = "35";
  const start = a.doc();
  a.hold();
  a.$("#feature-edit-ok")!.click();
  await turns();
  a.$("#feature-edit-cancel")!.click();
  await a.release();
  assert.equal(a.doc(), start, "Cancel leaves the design as it was");
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.ok(await a.close());
});
