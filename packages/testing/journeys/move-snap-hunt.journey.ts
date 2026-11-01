// Move, Timeline and undo bug hunt (2026-11-01) regressions: Snap in an edited Move from a body the Move didn't hold as built.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { bodyIdOf, bodyReference, builtBody, BodyCache, insertMove, insertPreset, joinBodies, NO_MOVE, partDocument, rebuildTimeline, shownBodies, type DesignDocument, type MoveValues } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const near = (got: readonly number[], want: readonly number[], what: string, eps = 1e-5) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= eps, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
async function views(doc: DesignDocument): Promise<Map<string, BodyView>> {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out = new Map<string, BodyView>();
    for (const id of build.order) { const b = builtBody(build, id); if (b !== undefined) out.set(id, (await cache.view(b.handle))!); }
    return out;
  } finally {
    await cache.close();
  }
}
async function sceneOf(doc: DesignDocument) {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    return joinBodies(await shownBodies(doc, await rebuildTimeline(doc, cache, kernel), cache));
  } finally {
    await cache.close();
  }
}
const faceWith = (view: BodyView, role: string) => view.face_roles.findIndex((r) => r?.role === role);

test("an edited Move given a new body (35e2i), then Snap from that body onto an unmoved body: it lands where picked", async () => {
  const { app } = await import("./design-app.ts");
  // Box 1 40 × 30 × 20 and Box 2 a 10 mm cube, both at the origin; Move 1 shifts Box 1 100 mm along X (x 100..140);
  // then Box 3, 20 × 20 × 5 at the origin: its top at z 5, centred (10, 10).
  const { doc: two, id: cube } = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  const m = insertMove(two, ["body:feature-1"], v({ x: 100 }));
  const { doc, id: plate } = insertPreset(m.doc, "box", 20, 20, 5);
  const scene = await sceneOf(doc);
  const [small, flat] = [cube, plate].map((f) => scene.bodies.findIndex((s) => s.feature === f));
  const a = await app(doc);
  await a.doubleClick(m.id);
  // Box 2 put in (its row): Move 1 moves Box 1 and the cube, the cube drawn 100 mm along X in the preview.
  a.selection.toggle(bodyReference(bodyIdOf(cube)));
  await a.settle();
  assert.equal(a.$("#move-bodies")!.textContent, "Bodies: Box 1, Box 2");
  (a.$("#move-snap") as HTMLButtonElement).click();
  await a.settle();
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "bottom") });
  await a.pick({ face: scene.faceStart[flat] + faceWith(scene.bodies[flat].view, "top") });
  assert.equal(a.$("#move-error")!.hidden, true, a.$("#move-error")!.textContent!);
  const box = (k: string) => Number((a.$(`#move-${k}`) as HTMLInputElement).value);
  // The cube's bottom centre (5, 5, 0) onto the plate's top centre (10, 10, 5): the shift (5, 5, 5).
  near([box("x"), box("y"), box("z")], [5, 5, 5], "the distance boxes");
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  // The cube 10 mm wide sits from (5, 5, 5) to (15, 15, 15).
  near((await views(a.doc())).get(cube)!.bounds.flat(), [5, 5, 5, 15, 15, 15], "the cube");
});
