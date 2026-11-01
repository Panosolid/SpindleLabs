// Undo bug hunt (2026-11-01): Undo made while Design is not on screen leaves Design's
// "put away by a restore" flag set, so the next mount, on a file opened
// afterwards, is taken for that restore's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MountedWorkspace, WorkspacePlugin } from "@fission/core";
import { addSketch, designWorkspace, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

test("a file opened after an Undo made in another workspace opens out of any sketch, framed", async () => {
  let away = false;
  // Design, or nothing while "another workspace is shown": the shell's pool forgets Design on Undo and mounts only the shown one.
  const plugin: WorkspacePlugin = {
    ...designWorkspace,
    mount: (ctx) => (away ? ({ unmount() {} } as MountedWorkspace) : designWorkspace.mount(ctx)),
  };
  const a = await app(partDocument("box", 40, 30, 20), plugin);
  // Sketch 1 on XY, drawn into (an undo step), and left open.
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  await a.key("sketch-line");
  await a.click(0, 0);
  await a.click(10, 0);
  await a.key("escape");
  assert.ok(a.sketching(), "in the sketch");
  const sketchId = a.doc().sketches[0].id;
  // Another workspace shown, then Undo there: the shell unmounts Design (forgetAll) while restoring, and mounts the other.
  away = true;
  assert.ok(a.history.undo());
  await a.settle();
  // A file opened (another person's, whose first sketch has the same id, as ids come from a counter), Design shown again.
  const made = addSketch(partDocument("cylinder", 10, 10, 50));
  assert.equal(made.id, sketchId, "the opened file's sketch has the same id");
  a.changeDesign(made.doc);
  away = false;
  const fitsBefore = a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits;
  await a.remount();
  assert.equal(a.sketching(), false, "the opened file is shown out of any sketch, as any opened file is");
  console.log("fits", fitsBefore, a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits);
  await a.close();
});

async function openAfter(undoAway: boolean) {
  let away = false;
  const plugin: WorkspacePlugin = { ...designWorkspace, mount: (ctx) => (away ? ({ unmount() {} } as MountedWorkspace) : designWorkspace.mount(ctx)) };
  const a = await app(partDocument("box", 40, 30, 20), plugin);
  const width = a.$("#width") as HTMLInputElement;
  width.value = "50";
  width.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.settle();
  away = true;
  if (undoAway) a.history.undo();
  else await a.remount(); // shown elsewhere, put away by the shell (no undo)
  await a.settle();
  a.changeDesign(partDocument("cylinder", 10, 10, 50));
  away = false;
  const el = a.window.document.querySelector<HTMLElement>("[data-fits]") ?? null;
  const before = Number(el?.dataset.fits ?? 0);
  await a.remount();
  const after = Number(a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits ?? 0);
  await a.close();
  return after - before;
}
test("a file opened after an Undo made in another workspace is framed, as one opened after no undo is", async () => {
  const plain = await openAfter(false);
  const afterUndo = await openAfter(true);
  assert.equal(plain, 1, "framed once without the undo");
  assert.equal(afterUndo, plain, "framed the same after an Undo made elsewhere");
});
