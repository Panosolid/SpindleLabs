// The Move tool (step 35e2b, move-tool.ts), worked by hand: which bodies a
// selection picks, the pivot a new Move starts at, a point turned and
// shifted the way a Move does it (the order of the turns among it), the
// preview mesh, the boxes read, and the numbers as a box shows them. From
// 35e2c: a drag's snapping (whole mm, 15°, at 0.9× and 1.1× of half a
// step), the angle wrapped, the handles' centre, a Move undone, and an
// edited Move's preview (by hand through a later Move; 300 seeded chains
// of Moves against building the chain again with the edit in it). The
// preview against the real kernel's moved body and the kernel's refusal
// are in packages/testing/journeys/move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh, GeometryReference } from "@fission/core";
import { NO_MOVE, type MoveValues } from "../src/move.ts";
import { boxCentre, boxText, draggedValues, editedMoveMesh, handlesCentre, MOVE_BOX_WORDS, MOVE_PREVIEW_LIMIT, movedMesh, movedPoint, pickedBodies, previewable, readMoveBoxes, snapDegrees, snapMm, startPivot, unmovedPoint, wrapDegrees } from "../src/move-tool.ts";
import { insertMove } from "../src/move.ts";
import { bodyIdOf, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { nameBody } from "../src/naming.ts";
import { bodyReference, designReference } from "../src/references.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { MOVE_PARAMS } from "../src/document.ts";
import { BOX_VIEW, CYLINDER_VIEW } from "./views.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const close = (got: readonly number[], want: readonly number[], what: string) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** One triangle per face (its own three points, normal +X) and one line per edge, as scene.test.ts lays them out. */
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
  return { feature, body: `body:${feature}`, place, view: vw, names: nameBody(feature, vw, () => null) };
};
// A 40 × 30 × 20 box at the origin (feature-1) and a ⌀20 × 10 cylinder standing at (100, 0, 0) (feature-4).
const box = shown("feature-1", BOX_VIEW, [[0, 0, 0], [40, 30, 20]]);
const cylinder = shown("feature-4", CYLINDER_VIEW, [[90, -10, 0], [110, 10, 10]], 2);
const scene = joinBodies([box, cylinder]);

test("a point turned the way a Move turns, by hand: counter-clockwise looking down each axis, X then Y then Z, then shifted", () => {
  // 90° about Z takes +X to +Y (x, y) → (−y, x); about X, +Y to +Z; about Y, +Z to +X.
  close(movedPoint([1, 0, 0], v({ turnZ: 90 })), [0, 1, 0], "Z");
  close(movedPoint([0, 1, 0], v({ turnX: 90 })), [0, 0, 1], "X");
  close(movedPoint([0, 0, 1], v({ turnY: 90 })), [1, 0, 0], "Y");
  // The order: (0, 1, 0) turned 90° about X is (0, 0, 1), then 90° about Y is (1, 0, 0).
  // Y first would leave (0, 1, 0) on the Y axis, then X would take it to (0, 0, 1): a different answer.
  close(movedPoint([0, 1, 0], v({ turnX: 90, turnY: 90 })), [1, 0, 0], "X then Y");
  // Through a pivot: the box's corner (40, 30, 20) about its middle (20, 15, 10), 90° about X:
  // from the middle it is (20, 15, 10); (y, z) → (−z, y) gives (20, −10, 15); back, (40, 5, 25).
  close(movedPoint([40, 30, 20], v({ turnX: 90, pivotX: 20, pivotY: 15, pivotZ: 10 })), [40, 5, 25], "about the middle");
  // Turned 180° about Z through the origin, then shifted (5, 0, 1): (2, 3, 4) → (−2, −3, 4) → (3, −3, 5).
  close(movedPoint([2, 3, 4], v({ turnZ: 180, x: 5, z: 1 })), [3, -3, 5], "turned then shifted");
  // A direction is turned, never shifted nor moved by the pivot: +X turned 90° about Z is +Y wherever the pivot is.
  close(movedPoint([1, 0, 0], v({ turnZ: 90, x: 7, pivotX: 50, pivotY: -3 }), true), [0, 1, 0], "a normal");
  // The pivot alone moves nothing.
  close(movedPoint([2, 3, 4], v({ pivotX: 9, pivotY: 9, pivotZ: 9 })), [2, 3, 4], "pivot alone");
});

test("the bodies a selection picks: a face or an edge picks its body, each once, in the scene's order", () => {
  const top = designReference("face", cylinder.names, 0)!;
  const edge = designReference("edge", box.names, 3)!;
  const items: GeometryReference[] = [top, edge, bodyReference("body:feature-4"), bodyReference("body:feature-1")];
  assert.deepEqual(pickedBodies(items, scene), ["body:feature-1", "body:feature-4"]);
  assert.deepEqual(pickedBodies([top], scene), ["body:feature-4"]);
  // A body not on screen (hidden, or not built), an outline and an empty selection pick nothing; nor does anything before a scene.
  assert.deepEqual(pickedBodies([bodyReference("body:feature-9"), { kind: "outline", id: "profile:sketch-2" as never }], scene), []);
  assert.deepEqual(pickedBodies([], scene), []);
  assert.deepEqual(pickedBodies([bodyReference("body:feature-1")], null), []);
});

test("a new Move's pivot: the centre of the box round the picked bodies, by hand", () => {
  // The box alone: (40/2, 30/2, 20/2) = (20, 15, 10).
  assert.deepEqual(startPivot(["body:feature-1"], scene), [20, 15, 10]);
  // Both: x 0..110, y −10..30, z 0..20, so (55, 10, 10).
  assert.deepEqual(startPivot(["body:feature-1", "body:feature-4"], scene), [55, 10, 10]);
  assert.deepEqual(boxCentre([]), [0, 0, 0], "nothing picked: the origin");
  assert.deepEqual(startPivot([], scene), [0, 0, 0]);
});

test("the preview moves only the picked bodies' points, lines and normals, keeping every list's length and numbering", () => {
  const m = movedMesh(scene, ["body:feature-4"], v({ x: 10 }));
  // The box's 6 faces × 3 points = 18 points (54 numbers) and 12 lines (72 numbers) stay; the cylinder's follow.
  assert.deepEqual(m.positions.slice(0, 54), scene.mesh.positions.slice(0, 54));
  assert.deepEqual(m.edge_lines.slice(0, 72), scene.mesh.edge_lines.slice(0, 72));
  // The cylinder's first point (0, 0, 0) moves to (10, 0, 0); its first line (0,0,0)-(0,1,1) to (10,0,0)-(10,1,1).
  close(m.positions.slice(54, 57), [10, 0, 0], "cylinder's first point");
  close(m.edge_lines.slice(72, 78), [10, 0, 0, 10, 1, 1], "cylinder's first line");
  assert.deepEqual(m.normals, scene.mesh.normals, "a shift turns no normal");
  for (const k of ["positions", "normals", "indices", "triangle_faces", "edge_lines", "edge_line_edges"] as const) assert.equal(m[k].length, scene.mesh[k].length, k);
  assert.equal(m.indices, scene.mesh.indices, "the triangles are the same list");
  // Turned 90° about Z: the normals +X become +Y, on the cylinder only.
  const t = movedMesh(scene, ["body:feature-4"], v({ turnZ: 90 }));
  close(t.normals.slice(54, 57), [0, 1, 0], "cylinder's normal");
  close(t.normals.slice(0, 3), [1, 0, 0], "box's normal");
  assert.equal(movedMesh(scene, ["body:feature-1"], v({ pivotX: 3 })), scene.mesh, "only a pivot: the mesh itself");
  assert.equal(movedMesh(scene, [], v({ x: 3 })).positions.join(), scene.mesh.positions.join(), "nothing picked: nothing moves");
});

test("the boxes read: every one a number (an empty one 0), or the first that isn't named", () => {
  const all = Object.fromEntries(MOVE_PARAMS.map((k) => [k, "0"])) as Record<(typeof MOVE_PARAMS)[number], string>;
  assert.deepEqual(readMoveBoxes({ ...all, x: "12.5", turnZ: "-90", pivotY: "1e3" }), { values: v({ x: 12.5, turnZ: -90, pivotY: 1000 }) });
  // An empty box counts as 0 (Ben, 2026-10-28), spaces alone too, and a box left out.
  assert.deepEqual(readMoveBoxes({ ...all, y: "" }), { values: v({}) }, "an empty box is 0");
  assert.deepEqual(readMoveBoxes({ ...all, x: "7", turnX: "  " }), { values: v({ x: 7 }) });
  assert.deepEqual(readMoveBoxes({ x: "3" }), { values: v({ x: 3 }) });
  assert.deepEqual(readMoveBoxes({ ...all, pivotZ: "ten" }), { bad: "pivotZ" });
  assert.deepEqual(readMoveBoxes({ ...all, z: "Infinity" }), { bad: "z" });
  assert.deepEqual(readMoveBoxes({ ...all, x: "1", y: "x" }), { bad: "y" }, "the first bad box, in the panel's order");
  assert.equal(`Type the ${MOVE_BOX_WORDS.turnY}.`, "Type the angle about Y in degrees.");
});

test("a number as a box shows it: to a nanometre, no -0; boundary at half a nanometre's rounding", () => {
  assert.equal(boxText(55), "55");
  assert.equal(boxText(-0), "0");
  assert.equal(boxText(-1e-9), "0", "rounds to 0, never \"-0\"");
  // The step is 1e-6 mm: 0.9 of a half step (4.5e-7) rounds down, 1.1 of it (5.5e-7) rounds up.
  assert.equal(boxText(12 + 4.5e-7), "12");
  assert.equal(boxText(12 + 5.5e-7), "12.000001");
  assert.equal(boxText(1 / 3), "0.333333");
});

test("a drag snapped by hand: whole millimetres and 15° steps, halves away from 0, no -0", () => {
  assert.deepEqual([2.4, 2.5, -2.5, 12.7, -0.4].map(snapMm), [2, 3, -3, 13, 0]);
  assert.ok(Object.is(snapMm(-0.4), 0), "no -0 mm");
  assert.deepEqual([7.4, 7.5, -22.5, 37, 100].map(snapDegrees), [0, 15, -30, 30, 105]);
  assert.ok(Object.is(snapDegrees(-3), 0), "no -0°");
});

test("snapping's boundary: 0.9× of half a step stays, 1.1× takes the step", () => {
  // Half a millimetre is where an arrow drag takes its first step: 0.45 mm none, 0.55 mm one.
  assert.equal(snapMm(0.9 * 0.5), 0);
  assert.equal(snapMm(1.1 * 0.5), 1);
  // Half of 15° is 7.5°: 6.75° none, 8.25° one step.
  assert.equal(snapDegrees(0.9 * 7.5), 0);
  assert.equal(snapDegrees(1.1 * 7.5), 15);
});

test("an angle wrapped into (−180°, 180°] by hand", () => {
  // 190° is 170° short of a whole turn the other way: −170°. 540° is one and a half turns: 180°. −180° is the same turn as 180°.
  assert.deepEqual([190, 180, -180, 540, -190, 360, 0, -15].map(wrapDegrees), [-170, 180, 180, 180, 170, 0, 0, -15]);
  assert.ok(Object.is(wrapDegrees(-360), 0), "no -0°");
});

test("a handle's drag sets only its own number, from the numbers at the press", () => {
  const start = v({ x: 2.5, turnZ: 170, pivotX: 4 });
  // 3.4 mm along X snaps to 3: 2.5 + 3 = 5.5 (the typed half is kept).
  assert.deepEqual(draggedValues(start, "x", 3.4), { ...start, x: 5.5 });
  // −7.6 mm along Z: −8.
  assert.deepEqual(draggedValues(start, "z", -7.6), { ...start, z: -8 });
  // 22° round Z snaps to 15°: 170 + 15 = 185, the same turn as −175°.
  assert.deepEqual(draggedValues(start, "turnZ", 22), { ...start, turnZ: -175 });
  // A press that hardly moves changes nothing: the same numbers.
  assert.equal(draggedValues(start, "x", 0.4), start);
  assert.equal(draggedValues(start, "turnX", -7), start);
});

test("the handles' centre is where the pivot ends up: the pivot shifted, by hand", () => {
  assert.deepEqual(handlesCentre(v({ x: 10, y: -2, pivotX: 1, pivotY: 2, pivotZ: 3, turnZ: 90 })), [11, 0, 3]);
});

test("seeded: a Move undone puts 1,000 random points and directions back", () => {
  let a = 35 >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 1000; n++) {
    const m = v({ x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100, z: (rand() - 0.5) * 100, turnX: (rand() - 0.5) * 720, turnY: (rand() - 0.5) * 720, turnZ: (rand() - 0.5) * 720, pivotX: rand() * 50, pivotY: rand() * 50, pivotZ: rand() * 50 });
    const p = [rand() * 100, rand() * 100, rand() * 100];
    unmovedPoint(movedPoint(p, m), m).forEach((x, k) => assert.ok(Math.abs(x - p[k]) < 1e-9, `point ${n}`));
    unmovedPoint(movedPoint(p, m, true), m, true).forEach((x, k) => assert.ok(Math.abs(x - p[k]) < 1e-9, `direction ${n}`));
  }
});

/** Box 1 (feature-1) and Cylinder 1 (feature-2); Move 1 (feature-3) shifts Box 1 10 mm along X; Move 2 (feature-4) then turns it 90° about X through the origin. */
function twoMoves(): DesignDocument {
  const doc = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 40, 40, 20).doc;
  return insertMove(insertMove(doc, ["body:feature-1"], v({ x: 10 })).doc, ["body:feature-1"], v({ turnX: 90 })).doc;
}

/** A scene of Box 1 and Cylinder 1 whose box has the point `p` and normal `n` first (as built), the rest as meshFor lays them out. */
function builtScene(p: number[], n: number[]) {
  const b = shown("feature-1", BOX_VIEW, [[0, 0, 0], [40, 30, 20]]);
  const mesh = { ...b.view.mesh, positions: [...p, ...b.view.mesh.positions.slice(3)], normals: [...n, ...b.view.mesh.normals.slice(3)] };
  return joinBodies([{ ...b, view: { ...b.view, mesh } }, shown("feature-2", CYLINDER_VIEW, [[-20, -20, 0], [20, 20, 20]], 2)]);
}

test("an edited Move's preview by hand: out through the later Move, Move 1 as typed, back through the later Move", () => {
  const doc = twoMoves();
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", "feature-2", "feature-3", "feature-4"]);
  // Box 1's point (1, 1, 0) with normal (0, 1, 0) is built: Move 1 → (11, 1, 0); Move 2, 90° about X (y goes to z, z to −y) → (11, 0, 1), normal (0, 0, 1).
  const scene = builtScene([11, 0, 1], [0, 0, 1]);
  const built = { "feature-1": { status: "built" }, "feature-2": { status: "built" }, "feature-3": { status: "built" }, "feature-4": { status: "built" } };
  // Move 1 edited to 90° about Z instead: (1, 1, 0) → (−1, 1, 0) (x goes to y, y to −x); then Move 2 → (−1, 0, 1).
  // The normal (0, 1, 0) → (−1, 0, 0), which a turn about X leaves.
  const m = editedMoveMesh(scene, doc, built, "feature-3", v({ turnZ: 90 }));
  close(m.positions.slice(0, 3), [-1, 0, 1], "the box's point");
  close(m.normals.slice(0, 3), [-1, 0, 0], "the box's normal");
  // The cylinder, which Move 1 doesn't move, is as built.
  const box = scene.bodies[0].view.mesh.positions.length;
  assert.deepEqual(m.positions.slice(box), scene.mesh.positions.slice(box));
  // The numbers as built: the mesh itself.
  assert.equal(editedMoveMesh(scene, doc, built, "feature-3", v({ x: 10 })), scene.mesh);
});

test("an edited Move's preview by hand when it or a later Move did not build", () => {
  const doc = twoMoves();
  // Move 1 failed (it moved nothing): (1, 1, 0) is built through Move 2 alone at (1, 0, 1). Edited to 10 mm along X: (11, 1, 0) → (11, 0, 1).
  const failed = { "feature-1": { status: "built" }, "feature-2": { status: "built" }, "feature-3": { status: "failed" }, "feature-4": { status: "built" } };
  close(editedMoveMesh(builtScene([1, 0, 1], [0, 0, 1]), doc, failed, "feature-3", v({ x: 10 })).positions.slice(0, 3), [11, 0, 1], "Move 1 failed");
  // Move 2 failed: the point is built at (11, 1, 0) by Move 1 alone, and nothing is taken back through Move 2. Edited to 90° about Z: (−1, 1, 0).
  const laterFailed = { ...failed, "feature-3": { status: "built" }, "feature-4": { status: "failed" } };
  close(editedMoveMesh(builtScene([11, 1, 0], [0, 1, 0]), doc, laterFailed, "feature-3", v({ turnZ: 90 })).positions.slice(0, 3), [-1, 1, 0], "Move 2 failed");
  // Move 1 suppressed, greyed or past the marker builds nothing whatever its numbers: the mesh itself.
  const scene = builtScene([1, 0, 1], [0, 0, 1]);
  for (const status of ["suppressed", "greyed", "rolled-back"]) assert.equal(editedMoveMesh(scene, doc, { ...failed, "feature-3": { status } }, "feature-3", v({ x: 10 })), scene.mesh, status);
  assert.equal(editedMoveMesh(scene, doc, {}, "feature-3", v({ x: 10 })), scene.mesh, "not built at all");
  assert.equal(editedMoveMesh(scene, doc, failed, "feature-3", v({ pivotX: 5 })), scene.mesh, "a failed Move edited to move nothing");
  assert.equal(editedMoveMesh(scene, doc, failed, "feature-1", v({ x: 10 })), scene.mesh, "not a Move");
});

test("seeded: 300 chains of Moves on two bodies; an edited Move's preview is the chain built again with the edit in it", () => {
  let a = 2026 >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomMove = () => v({ x: Math.round((rand() - 0.5) * 40), y: Math.round((rand() - 0.5) * 40), z: Math.round((rand() - 0.5) * 40), turnX: 15 * Math.round((rand() - 0.5) * 24), turnY: 15 * Math.round((rand() - 0.5) * 24), turnZ: 15 * Math.round((rand() - 0.5) * 24), pivotX: rand() * 40, pivotY: rand() * 40, pivotZ: rand() * 40 });
  const original = joinBodies([box, shown("feature-2", CYLINDER_VIEW, [[90, -10, 0], [110, 10, 10]], 2)]);
  for (let n = 0; n < 300; n++) {
    let doc: DesignDocument = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 20, 20, 10).doc;
    const moves: { id: string; bodies: string[]; values: MoveValues; built: boolean }[] = [];
    const count = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const bodies = rand() < 0.5 ? ["feature-1"] : rand() < 0.5 ? ["feature-2"] : ["feature-1", "feature-2"];
      const values = randomMove();
      const made = insertMove(doc, bodies.map(bodyIdOf), values);
      doc = made.doc;
      moves.push({ id: made.id, bodies, values, built: rand() < 0.8 });
    }
    /** The scene as the chain builds it, with Move `edit` at `to` when given: each built Move in turn (a failed one moves nothing). */
    const chain = (edit?: string, to?: MoveValues) => moves.reduce((scene, m) => (m.built || m.id === edit ? { ...scene, mesh: movedMesh(scene, m.bodies.map(bodyIdOf), m.id === edit ? to! : m.values) } : scene), original);
    const results = Object.fromEntries([["feature-1", { status: "built" }], ["feature-2", { status: "built" }], ...moves.map((m) => [m.id, { status: m.built ? "built" : "failed" }])]);
    const edited = moves[Math.floor(rand() * moves.length)];
    const to = randomMove();
    const got = editedMoveMesh(chain(), doc, results, edited.id, to);
    const want = chain(edited.id, to).mesh;
    got.positions.forEach((x, i) => assert.ok(Math.abs(x - want.positions[i]) < 1e-8, `chain ${n}: position ${i} ${x} vs ${want.positions[i]}`));
    got.normals.forEach((x, i) => assert.ok(Math.abs(x - want.normals[i]) < 1e-9, `chain ${n}: normal ${i}`));
    got.edge_lines.forEach((x, i) => assert.ok(Math.abs(x - want.edge_lines[i]) < 1e-8, `chain ${n}: line ${i}`));
  }
});

test("the preview draws a Move only within 1e9 mm (boundary 0.9× draws, 1.1× doesn't; weak-spot hunt 10-29: 1e308 gave the view NaN)", () => {
  const base = { ...NO_MOVE };
  assert.equal(previewable(base), true);
  for (const k of ["x", "y", "z", "pivotX", "pivotY", "pivotZ"] as const) {
    assert.equal(previewable({ ...base, [k]: 0.9 * MOVE_PREVIEW_LIMIT }), true, `${k} 0.9×`);
    assert.equal(previewable({ ...base, [k]: -1.1 * MOVE_PREVIEW_LIMIT }), false, `${k} −1.1×`);
    assert.equal(previewable({ ...base, [k]: 1e308 }), false, `${k} 1e308`);
  }
  // Angles are not distances: any turn is drawn (its sine and cosine stay in range).
  assert.equal(previewable({ ...base, turnZ: 1e12 }), true);
});
