// The Move tool (step 35e2b, move-tool.ts), worked by hand: which bodies a
// selection picks, the pivot a new Move starts at, a point turned and
// shifted the way a Move does it (the order of the turns among it), the
// preview mesh, the boxes read, and the numbers as a box shows them. The
// preview against the real kernel's moved body and the kernel's refusal
// are in packages/testing/journeys/move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh, GeometryReference } from "@fission/core";
import { NO_MOVE, type MoveValues } from "../src/move.ts";
import { boxCentre, boxText, MOVE_BOX_WORDS, movedMesh, movedPoint, pickedBodies, readMoveBoxes, startPivot } from "../src/move-tool.ts";
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
  return { feature, place, view: vw, names: nameBody(feature, vw, () => null) };
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
  const items: GeometryReference[] = [top, edge, bodyReference("feature-4"), bodyReference("feature-1")];
  assert.deepEqual(pickedBodies(items, scene), ["feature-1", "feature-4"]);
  assert.deepEqual(pickedBodies([top], scene), ["feature-4"]);
  // A body not on screen (hidden, or not built), an outline and an empty selection pick nothing; nor does anything before a scene.
  assert.deepEqual(pickedBodies([bodyReference("feature-9"), { kind: "outline", id: "profile:sketch-2" as never }], scene), []);
  assert.deepEqual(pickedBodies([], scene), []);
  assert.deepEqual(pickedBodies([bodyReference("feature-1")], null), []);
});

test("a new Move's pivot: the centre of the box round the picked bodies, by hand", () => {
  // The box alone: (40/2, 30/2, 20/2) = (20, 15, 10).
  assert.deepEqual(startPivot(["feature-1"], scene), [20, 15, 10]);
  // Both: x 0..110, y −10..30, z 0..20, so (55, 10, 10).
  assert.deepEqual(startPivot(["feature-1", "feature-4"], scene), [55, 10, 10]);
  assert.deepEqual(boxCentre([]), [0, 0, 0], "nothing picked: the origin");
  assert.deepEqual(startPivot([], scene), [0, 0, 0]);
});

test("the preview moves only the picked bodies' points, lines and normals, keeping every list's length and numbering", () => {
  const m = movedMesh(scene, ["feature-4"], v({ x: 10 }));
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
  const t = movedMesh(scene, ["feature-4"], v({ turnZ: 90 }));
  close(t.normals.slice(54, 57), [0, 1, 0], "cylinder's normal");
  close(t.normals.slice(0, 3), [1, 0, 0], "box's normal");
  assert.equal(movedMesh(scene, ["feature-1"], v({ pivotX: 3 })), scene.mesh, "only a pivot: the mesh itself");
  assert.equal(movedMesh(scene, [], v({ x: 3 })).positions.join(), scene.mesh.positions.join(), "nothing picked: nothing moves");
});

test("the boxes read: every one a number, or the first that isn't named", () => {
  const all = Object.fromEntries(MOVE_PARAMS.map((k) => [k, "0"])) as Record<(typeof MOVE_PARAMS)[number], string>;
  assert.deepEqual(readMoveBoxes({ ...all, x: "12.5", turnZ: "-90", pivotY: "1e3" }), { values: v({ x: 12.5, turnZ: -90, pivotY: 1000 }) });
  assert.deepEqual(readMoveBoxes({ ...all, y: "" }), { bad: "y" }, "an empty box is not 0");
  assert.deepEqual(readMoveBoxes({ ...all, turnX: "  " }), { bad: "turnX" });
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
