// Changing which bodies an edited Move moves (35e2i), worked by hand: the
// document change (`changedMove` with bodies) and every refusal, the
// preview of a Move whose bodies changed (`editedMoveMesh`: a body taken
// out goes back to where it was before the Move, one put in is moved by
// the boxes), and the picks (`editedBodies`: hidden bodies the Move holds
// stay, a body made after the Move is refused in words). The rebuild on the
// real kernel is packages/testing/journeys/move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh, Feature } from "@fission/core";
import { insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, madeAfter, NO_MOVE, type MoveValues } from "../src/move.ts";
import { editedBodies, editedMoveMesh, movedMesh } from "../src/move-tool.ts";
import { nameBody } from "../src/naming.ts";
import { joinBodies, type Scene, type ShownBody } from "../src/scene.ts";
import { BOX_VIEW, CYLINDER_VIEW } from "./views.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const item = (d: DesignDocument, id: string): Feature => d.timeline.features.find((f) => f.id === id)!;
const close = (got: readonly number[], want: readonly number[], what: string) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** Box 1 (feature-1), Cylinder 1 (feature-2), Move 1 (feature-3) shifting Box 1 10 mm along X, then Box 2 (feature-4) made after it. */
function moveThenBox(): DesignDocument {
  const d = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 40, 40, 20).doc;
  return insertPreset(insertMove(d, ["feature-1"], v({ x: 10 })).doc, "box", 10, 10, 10).doc;
}

/** One triangle per face (its own three points, normal +X) and one line per edge, as move-tool.test.ts lays them out. */
function meshFor(faces: number, edges: number): DisplayMesh {
  const mesh: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  for (let f = 0; f < faces; f++) {
    mesh.positions.push(f, 0, 0, f, 1, 0, f, 0, 1);
    mesh.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    mesh.indices.push(3 * f, 3 * f + 1, 3 * f + 2);
    mesh.triangle_faces.push(f);
  }
  for (let e = 0; e < edges; e++) {
    mesh.edge_lines.push(e, 0, 0, e, 1, 1);
    mesh.edge_line_edges.push(e);
  }
  return mesh;
}
const shown = (feature: string, view: BodyView, bounds: BodyView["bounds"], place = 1): ShownBody => {
  const vw = { ...view, bounds, mesh: meshFor(view.faces, view.edges) };
  return { feature, place, view: vw, names: nameBody(feature, vw, () => null) };
};

test("changedMove with bodies, by hand: the Move's bodies, their names and its words change; its place, numbers and name stay", () => {
  const d = moveThenBox();
  // Cylinder 1 put in beside Box 1.
  const both = changedMove(d, "feature-3", v({ x: 10 }), ["feature-1", "feature-2"]);
  const m = item(both, "feature-3");
  assert.deepEqual(m.dependsOn, ["feature-1", "feature-2"]);
  assert.deepEqual(m.provenance.from.map((r) => [r.id, r.label]), [["feature-1", "Box 1"], ["feature-2", "Cylinder 1"]]);
  assert.equal(m.intent.summary, "Move 2 bodies by (10, 0, 0) mm");
  assert.equal(m.provenance.self.label, "Move 1");
  assert.deepEqual(both.timeline.features.map((f) => f.id), d.timeline.features.map((f) => f.id), "its place kept");
  assert.equal(both.nextId, d.nextId, "no new id");
  // Box 1 swapped for Cylinder 1, and the numbers changed at the same time.
  const swapped = item(changedMove(d, "feature-3", v({ y: 5 }), ["feature-2"]), "feature-3");
  assert.deepEqual([swapped.dependsOn, swapped.intent.summary, swapped.intent.parameters.y], [["feature-2"], "Move Cylinder 1 by (0, 5, 0) mm", 5]);
  // The same bodies, given or not, in any order, at the same numbers: nothing changes.
  assert.equal(changedMove(d, "feature-3", v({ x: 10 }), ["feature-1"]), d);
  assert.equal(changedMove(both, "feature-3", v({ x: 10 }), ["feature-2", "feature-1"]), both);
  assert.equal(changedMove(both, "feature-3", v({ x: 10 })), both, "no bodies given keeps its own");
  // A Rotate stays a Rotate in its words.
  const r = insertMove(d, ["feature-1"], v({ turnZ: 90 }), "rotate");
  assert.equal(item(changedMove(r.doc, r.id, v({ turnZ: 90 }), ["feature-2"]), r.id).intent.summary, "Rotate Cylinder 1 turned 90° about Z");
  // The file checks take the changed Move: read back the same.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(both))).timeline.features, both.timeline.features);
});

test("changedMove refuses bodies it can't move, each in words, and changes nothing", () => {
  const d = moveThenBox();
  const refused = (bodies: string[], words: string) => assert.throws(() => changedMove(d, "feature-3", v({ x: 10 }), bodies), { message: words });
  refused([], "pick at least one body for Move 1 to move");
  refused(["feature-2", "feature-2"], "feature-2 is picked twice");
  refused(["feature-3"], "feature-3 is not a body in the design");
  refused(["feature-99"], "feature-99 is not a body in the design");
  // Box 2 is made after Move 1: the kernel would be asked to move a body that isn't made yet.
  refused(["feature-1", "feature-4"], "Box 2 is made after Move 1 in the timeline, so Move 1 can't move it");
  assert.equal(madeAfter("Box 2", "Move 1"), "Box 2 is made after Move 1 in the timeline, so Move 1 can't move it.");
});

test("a body the Move holds that was deleted since may stay under its old name; one it never held can't be put in", () => {
  const d = moveThenBox();
  // As a file may hold it: Box 1 gone, Move 1 still naming it.
  const gone: DesignDocument = { ...d, timeline: { ...d.timeline, features: d.timeline.features.filter((f) => f.id !== "feature-1") } };
  const kept = item(changedMove(gone, "feature-3", v({ x: 10 }), ["feature-1", "feature-2"]), "feature-3");
  assert.deepEqual(kept.dependsOn, ["feature-1", "feature-2"]);
  assert.equal(kept.intent.summary, "Move 2 bodies by (10, 0, 0) mm");
  assert.deepEqual(kept.provenance.from.map((r) => r.label), ["Box 1", "Cylinder 1"]);
  // Taken out, it is gone for good.
  assert.deepEqual(item(changedMove(gone, "feature-3", v({ x: 10 }), ["feature-2"]), "feature-3").dependsOn, ["feature-2"]);
  // A deleted body Move 1 never held is refused.
  const other = insertMove(gone, ["feature-2"], v({ x: 1 }));
  assert.throws(() => changedMove(other.doc, other.id, v({ x: 1 }), ["feature-1"]), { message: "feature-1 is not a body in the design" });
});

/** Box 1 (feature-1) and Cylinder 1 (feature-2); Move 1 (feature-3) shifts Box 1 10 mm along X; Move 2 (feature-4) then turns Box 1 90° about X through the origin. */
function twoMoves(): DesignDocument {
  const doc = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 40, 40, 20).doc;
  return insertMove(insertMove(doc, ["feature-1"], v({ x: 10 })).doc, ["feature-1"], v({ turnX: 90 })).doc;
}
const built = { "feature-1": { status: "built" }, "feature-2": { status: "built" }, "feature-3": { status: "built" }, "feature-4": { status: "built" } };

test("an edited Move's preview with its bodies changed, by hand: a body taken out goes back, one put in moves", () => {
  // Box 1's point (1, 1, 0), normal (0, 1, 0), is built: Move 1 → (11, 1, 0); Move 2, 90° about X ((y, z) → (−z, y)) → (11, 0, 1), normal (0, 0, 1).
  const b = shown("feature-1", BOX_VIEW, [[0, 0, 0], [40, 30, 20]]);
  const boxMesh = { ...b.view.mesh, positions: [11, 0, 1, ...b.view.mesh.positions.slice(3)], normals: [0, 0, 1, ...b.view.mesh.normals.slice(3)] };
  const scene = joinBodies([{ ...b, view: { ...b.view, mesh: boxMesh } }, shown("feature-2", CYLINDER_VIEW, [[-20, -20, 0], [20, 20, 20]], 2)]);
  const cyl = boxMesh.positions.length; // the cylinder's first point, meshFor's (0, 0, 0), comes after the box's
  // Move 1 edited to move Cylinder 1 instead, 10 mm along X still.
  // Box 1: back out of Move 2 ((y, z) → (z, −y)): (11, 1, 0); out of Move 1: (1, 1, 0); not moved by the edit; Move 2 again: (1, 0, 1).
  // Its normal: (0, 0, 1) → (0, 1, 0), a shift leaves it, → (0, 0, 1).
  // Cylinder 1: no later Move holds it and Move 1 didn't as built: (0, 0, 0) moved 10 along X → (10, 0, 0).
  const swapped = editedMoveMesh(scene, twoMoves(), built, "feature-3", v({ x: 10 }), ["feature-2"]);
  close(swapped.positions.slice(0, 3), [1, 0, 1], "Box 1 taken out");
  close(swapped.normals.slice(0, 3), [0, 0, 1], "Box 1's normal");
  close(swapped.positions.slice(cyl, cyl + 3), [10, 0, 0], "Cylinder 1 put in");
  // Both, at 90° about Z instead: Box 1 out to (1, 1, 0), turned ((x, y) → (−y, x)) to (−1, 1, 0), Move 2 → (−1, 0, 1); Cylinder 1's (0, 0, 0) on the axis stays.
  const both = editedMoveMesh(scene, twoMoves(), built, "feature-3", v({ turnZ: 90 }), ["feature-1", "feature-2"]);
  close(both.positions.slice(0, 3), [-1, 0, 1], "Box 1 turned");
  close(both.positions.slice(cyl + 3, cyl + 6), [-1, 0, 0], "Cylinder 1's (0, 1, 0) turned to (−1, 0, 0)");
  // Its own bodies, given or not, at its own numbers: the mesh itself.
  assert.equal(editedMoveMesh(scene, twoMoves(), built, "feature-3", v({ x: 10 }), ["feature-1"]), scene.mesh);
  assert.equal(editedMoveMesh(scene, twoMoves(), built, "feature-3", v({ x: 10 })), scene.mesh);
  // Move 1 failed (moved nothing), edited to Cylinder 1: nothing to take back from Box 1, which stays as built.
  const failed = { ...built, "feature-3": { status: "failed" } };
  close(editedMoveMesh(scene, twoMoves(), failed, "feature-3", v({ x: 10 }), ["feature-2"]).positions.slice(0, 3), [11, 0, 1], "a failed Move's old body");
});

test("an edited Move's picks, by hand: hidden bodies it holds stay, the rest are the picks in timeline order, and a body made after it is refused", () => {
  const d = moveThenBox();
  const scene: Scene = joinBodies([shown("feature-1", BOX_VIEW, [[10, 0, 0], [50, 30, 20]]), shown("feature-2", CYLINDER_VIEW, [[-20, -20, 0], [20, 20, 20]], 2), shown("feature-4", BOX_VIEW, [[0, 0, 0], [10, 10, 10]], 3)]);
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], ["feature-2", "feature-1"], scene), { bodies: ["feature-1", "feature-2"], refused: null });
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], ["feature-2"], scene), { bodies: ["feature-2"], refused: null }, "Box 1 clicked off");
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], [], scene), { bodies: [], refused: null }, "everything clicked off: OK will say to pick one");
  // Box 2 is made after Move 1: let go, in words.
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], ["feature-1", "feature-4"], scene), { bodies: ["feature-1"], refused: "Box 2 is made after Move 1 in the timeline, so Move 1 can't move it." });
  // Box 1 hidden (not in the scene): it can't be clicked off, so it stays.
  const hidden = joinBodies([scene.bodies[1], scene.bodies[2]]);
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], ["feature-2"], hidden), { bodies: ["feature-1", "feature-2"], refused: null });
  assert.deepEqual(editedBodies(d, "feature-3", ["feature-1"], [], null), { bodies: ["feature-1"], refused: null }, "no scene yet");
});

test("seeded: 2,000 chains of Moves on two bodies, one edited to other bodies and numbers; the preview is the chain built again with the edit in it", () => {
  let a = 3517 >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomMove = () => v({ x: Math.round((rand() - 0.5) * 40), y: Math.round((rand() - 0.5) * 40), z: Math.round((rand() - 0.5) * 40), turnX: 15 * Math.round((rand() - 0.5) * 24), turnY: 15 * Math.round((rand() - 0.5) * 24), turnZ: 15 * Math.round((rand() - 0.5) * 24), pivotX: rand() * 40, pivotY: rand() * 40, pivotZ: rand() * 40 });
  const randomBodies = () => (rand() < 1 / 3 ? ["feature-1"] : rand() < 0.5 ? ["feature-2"] : ["feature-1", "feature-2"]);
  const original = joinBodies([shown("feature-1", BOX_VIEW, [[0, 0, 0], [40, 30, 20]]), shown("feature-2", CYLINDER_VIEW, [[90, -10, 0], [110, 10, 10]], 2)]);
  let changed = 0;
  for (let n = 0; n < 2000; n++) {
    let doc: DesignDocument = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 20, 20, 10).doc;
    const moves: { id: string; bodies: string[]; values: MoveValues; built: boolean }[] = [];
    const count = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const bodies = randomBodies();
      const values = randomMove();
      const made = insertMove(doc, bodies, values);
      doc = made.doc;
      moves.push({ id: made.id, bodies, values, built: rand() < 0.8 });
    }
    const chain = (edit?: { id: string; to: MoveValues; bodies: string[] }) =>
      moves.reduce((scene, m) => (m.built || m.id === edit?.id ? { ...scene, mesh: movedMesh(scene, m.id === edit?.id ? edit.bodies : m.bodies, m.id === edit?.id ? edit.to : m.values) } : scene), original);
    const results = Object.fromEntries([["feature-1", { status: "built" }], ["feature-2", { status: "built" }], ...moves.map((m) => [m.id, { status: m.built ? "built" : "failed" }])]);
    const edited = moves[Math.floor(rand() * moves.length)];
    const edit = { id: edited.id, to: rand() < 0.3 ? edited.values : randomMove(), bodies: randomBodies() };
    if (edit.bodies.join() !== edited.bodies.join()) changed++;
    const got = editedMoveMesh(chain(), doc, results, edit.id, edit.to, edit.bodies);
    const want = chain(edit).mesh;
    got.positions.forEach((x, i) => assert.ok(Math.abs(x - want.positions[i]) < 1e-8, `chain ${n}: position ${i} ${x} vs ${want.positions[i]}`));
    got.normals.forEach((x, i) => assert.ok(Math.abs(x - want.normals[i]) < 1e-9, `chain ${n}: normal ${i}`));
    got.edge_lines.forEach((x, i) => assert.ok(Math.abs(x - want.edge_lines[i]) < 1e-8, `chain ${n}: line ${i}`));
  }
  assert.ok(changed > 1000, `the bodies changed in ${changed} of 2,000 chains`);
});
