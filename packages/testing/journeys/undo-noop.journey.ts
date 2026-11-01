// Undo bug hunt (2026-11-01): actions that change nothing add no undo step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

function start() {
  const made = addSketch(partDocument("box", 40, 30, 20));
  return extrudeSketch(drawRectangle(made.doc, made.id, [100, 0], [140, 30]).doc, made.id, 10).doc;
}

test("Edit feature OK, Edit Sketch finished, and the Move panel OK with nothing changed add no undo step", async () => {
  const a = await app(start(), designWorkspace);
  const [box, sketch, extrude] = a.doc().timeline.features.map((f) => f.id);
  const steps: string[] = [];
  const note = (what: string) => steps.push(`${what}: ${a.history.undoLabel()}`);
  assert.equal(await a.menu(box, "edit"), null);
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  note("edit box ok");
  assert.equal(await a.menu(extrude, "edit"), null);
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  note("edit extrude ok");
  assert.equal(await a.menu(sketch, "edit-sketch"), null);
  await a.finish();
  note("edit sketch finished");
  a.$("#move")?.click();
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement | null)?.click();
  await a.settle();
  note("move ok");
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.key("clear-selection");
  note("create sketch, escape");
  a.$("#sketch-extrude")?.click();
  await a.settle();
  await a.key("clear-selection");
  note("extrude, escape");
  console.log(steps);
  assert.equal(a.history.canUndo(), false, `nothing changed: ${steps.join("; ")}`);
  await a.close();
});
