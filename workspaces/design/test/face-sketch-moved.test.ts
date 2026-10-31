// A sketch on a face of a moved body (35e2h): it is carried by what the
// Moves before it did to the face's body since it was drawn (face-sketch.ts
// `bodyFrame`, `carried`, `frameNow`'s carry), so a Move edited to slide
// the face along itself, or to turn it about its normal, takes the sketch
// with it; the face's plane still has the last word. Hand-worked frames,
// the face-pick and file paths, and seeded checks against the Move
// preview's own arithmetic (move-tool.ts `movedPoint`, a separate path).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec, BodyView, Motion, Plane } from "@fission/core";
import { bodyFrame, carried, frameNow, squared } from "../src/face-sketch.ts";
import { addFaceSketch } from "../src/sketch.ts";
import { partDocument } from "../src/document.ts";
import { moveMotions, NO_MOVE, type MoveValues } from "../src/move.ts";
import { movedPoint } from "../src/move-tool.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { nameBody } from "../src/naming.ts";
import { boxView } from "./views.ts";

type Vec3 = [number, number, number];
const plane = (origin: number[], xAxis: number[], normal: number[]): Plane => ({ origin: origin as Vec3, xAxis: xAxis as Vec3, normal: normal as Vec3 });
const SHAPE = { box: { size: [40, 30, 20] } } as unknown as BodySpec;
const movedBy = (moves: Motion[]): BodySpec => ({ moved: { body: SHAPE as never, moves } });
const QUARTER = Math.PI / 2;

function near(got: readonly number[], want: readonly number[], what: string, within = 1e-12) {
  for (const [k, x] of got.entries()) assert.ok(Math.abs(x - want[k]) <= within, `${what}: [${got}] want [${want}]`);
}
function nearPlane(got: Plane | null, want: Plane, what: string, within = 1e-12) {
  assert.ok(got !== null, `${what}: no frame`);
  near(got.origin, want.origin, `${what} origin`, within);
  near(got.xAxis, want.xAxis, `${what} x`, within);
  near(got.normal, want.normal, `${what} normal`, within);
}

/** The top of the 40 × 30 × 20 box as drawn unmoved: rule 8 gives the world's XY lifted to z = 20. */
const TOP = plane([0, 0, 20], [1, 0, 0], [0, 0, 1]);

test("hand-worked: bodyFrame is where a body's moves put the world's frame, in order", () => {
  assert.equal(bodyFrame(SHAPE), null, "a body never moved");
  assert.equal(bodyFrame(movedBy([])), null, "moved by nothing");
  nearPlane(bodyFrame(movedBy([{ move: [3, 4, 5] }])), plane([3, 4, 5], [1, 0, 0], [0, 0, 1]), "shifted");
  // A quarter turn counter-clockwise looking down +z (the axis needn't be
  // unit) about the line through (10, 0, 0): the origin is (−10, 0) from the
  // pivot, and (a, b) → (−b, a) takes it to (0, −10), so (10, −10, 0); x
  // turns to y; the normal is the axis, so it stays.
  nearPlane(bodyFrame(movedBy([{ turn: { pivot: [10, 0, 0], axis: [0, 0, 2], angle: QUARTER } }])), plane([10, -10, 0], [0, 1, 0], [0, 0, 1]), "turned about z");
  // A quarter turn about +x through the origin: (y, z) → (−z, y), so the normal (0, 0, 1) goes to (0, −1, 0) and x stays.
  nearPlane(bodyFrame(movedBy([{ turn: { pivot: [0, 0, 0], axis: [1, 0, 0], angle: QUARTER } }])), plane([0, 0, 0], [1, 0, 0], [0, -1, 0]), "turned about x");
  // Order counts: shifted (1, 0, 0) then turned a quarter about z through the origin puts the origin at (0, 1, 0), not (1, 0, 0).
  nearPlane(bodyFrame(movedBy([{ move: [1, 0, 0] }, { turn: { pivot: [0, 0, 0], axis: [0, 0, 1], angle: QUARTER } }])), plane([0, 1, 0], [0, 1, 0], [0, 0, 1]), "shift then turn");
});

test("hand-worked: carried maps points and directions from one body frame to another, and is nothing for the same frame", () => {
  assert.equal(carried(undefined, undefined), null, "never moved");
  const at = plane([5, 0, 0], [1, 0, 0], [0, 0, 1]);
  assert.equal(carried(at, { ...at }), null, "moved, but not since drawn");
  // From the world to shifted (7, 3, 0): a point moves with it, a direction doesn't.
  const slide = carried(undefined, plane([7, 3, 0], [1, 0, 0], [0, 0, 1]))!;
  near(slide([1, 2, 3], false), [8, 5, 3], "point");
  near(slide([1, 2, 3], true), [1, 2, 3], "direction");
  // From shifted (5, 0, 0) to turned a quarter about z at the origin: (6, 0, 0) is 1 along the old x; the new x is y, so (0, 1, 0).
  near(carried(at, plane([0, 0, 0], [0, 1, 0], [0, 0, 1]))!([6, 0, 0], false), [0, 1, 0], "back and turned");
});

test("hand-worked: a sketch on the top slides and turns with its face when a Move before it is edited (35e2h)", () => {
  // Slid (7, 3, 0) since drawn, the top's middle now at (27, 18, 20): the origin slides with it, x as it was.
  nearPlane(frameNow(TOP, [0, 0, 1], [27, 18, 20], carried(undefined, plane([7, 3, 0], [1, 0, 0], [0, 0, 1]))), plane([7, 3, 20], [1, 0, 0], [0, 0, 1]), "slid");
  // Before 35e2h the origin stayed where the world's origin meets the plane: (0, 0, 20). Without a carry it still does.
  nearPlane(frameNow(TOP, [0, 0, 1], [27, 18, 20]), TOP, "no carry");
  // Drawn after a Move of (5, 0, 0), that Move edited to (12, 0, 0): carried by the difference, (7, 0, 0).
  nearPlane(frameNow(TOP, [0, 0, 1], [32, 15, 20], carried(plane([5, 0, 0], [1, 0, 0], [0, 0, 1]), plane([12, 0, 0], [1, 0, 0], [0, 0, 1]))), plane([7, 0, 20], [1, 0, 0], [0, 0, 1]), "edited Move");
  // Turned a quarter about z through the box's middle line (20, 15): the
  // world's origin is (−20, −15) from it, (a, b) → (−b, a) gives (15, −20),
  // so (35, −5); x turns to y. Check by a sketch point (a, b): drawn at
  // world (a, b, 20), turned to (35 − b, −5 + a, 20); the frame gives
  // origin + a x + b (n × x) = (35, −5, 20) + a (0, 1, 0) + b (−1, 0, 0). The same.
  nearPlane(frameNow(TOP, [0, 0, 1], [20, 15, 20], carried(undefined, bodyFrame(movedBy([{ turn: { pivot: [20, 15, 0], axis: [0, 0, 1], angle: QUARTER } }]))!)), plane([35, -5, 20], [0, 1, 0], [0, 0, 1]), "turned about its normal");
  // The face's plane has the last word: moved up 5 since drawn, but the box also grew to 40 tall, so the top is at z = 45.
  nearPlane(frameNow(TOP, [0, 0, 1], [20, 15, 45], carried(undefined, plane([0, 0, 5], [1, 0, 0], [0, 0, 1]))), plane([0, 0, 45], [1, 0, 0], [0, 0, 1]), "plane wins");
  // The bottom (drawn as XY's frame, side −1) turned half a turn about x:
  // it now looks up. Carried, the normal is (0, 0, −1) and x stays, so a
  // point (a, b) lands at (a, −b, 0), where the half turn puts (a, b, 0).
  // Without the carry the frame would keep +z and mirror the sketch.
  nearPlane(frameNow(plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), [0, 0, 1], [20, -15, 0], carried(undefined, bodyFrame(movedBy([{ turn: { pivot: [0, 0, 0], axis: [1, 0, 0], angle: Math.PI } }]))!)), plane([0, 0, 0], [1, 0, 0], [0, 0, -1]), "bottom turned over");
});

test("a face picked gives the new sketch where the Moves had put its body, the world's frame when none had", () => {
  // The box's faces in make_box's order (face-pick.test.ts): the top is face 1. No mesh: the pick reads only normals and names.
  const view = { ...boxView(40, 30, 20), mesh: { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] }, face_normals: [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]], face_centroids: [[20, 15, 0], [20, 15, 20], [20, 0, 10], [20, 30, 10], [0, 15, 10], [40, 15, 10]] } as BodyView;
  const top = 1;
  const at = plane([7, 3, 0], [1, 0, 0], [0, 0, 1]);
  const body = (frame?: Plane): ShownBody => ({ feature: "feature-1", body: "body:feature-1", place: 1, view, names: nameBody("feature-1", view, () => null), ...(frame ? { frame } : {}) });
  const moved = sketchSpot({ face: top, shift: false }, joinBodies([body(at)]));
  assert.ok(moved?.kind === "face", JSON.stringify(moved));
  assert.deepEqual(moved.drawn.body, at);
  const kept = addFaceSketch(partDocument("box", 40, 30, 20), moved.face, moved.drawn).doc.sketches.at(-1)!.face!;
  assert.deepEqual(kept.body, at);
  // Never moved: the world's frame, so a Move put in before it later carries it.
  const still = sketchSpot({ face: top, shift: false }, joinBodies([body()]));
  assert.ok(still?.kind === "face", JSON.stringify(still));
  assert.deepEqual(still.drawn.body, plane([0, 0, 0], [1, 0, 0], [0, 0, 1]));
  assert.deepEqual(addFaceSketch(partDocument("box", 40, 30, 20), still.face, still.drawn).doc.sketches.at(-1)!.face!.body, plane([0, 0, 0], [1, 0, 0], [0, 0, 1]));
  // A placement with no body (a file from before 35e2h, or a caller that doesn't know) keeps none.
  assert.equal(addFaceSketch(partDocument("box", 40, 30, 20), still.face, { plane: still.drawn.plane, side: 1 }).doc.sketches.at(-1)!.face!.body, undefined);
  // A body frame that can't be a frame is refused (a broken caller, not a pick).
  assert.throws(() => addFaceSketch(partDocument("box", 40, 30, 20), moved.face, { ...moved.drawn, body: plane([0, 0, 0], [0, 0, 1], [0, 0, 1]) }), /needs a frame for where its body was moved to/);
});

/** Mulberry32, seeded. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.FISSION_SEED ?? "35");

/** A random Move's numbers: shifts to ±500 mm, angles to ±180°, a pivot to ±200 mm; each left 0 one time in three. */
function randomMove(rand: () => number): MoveValues {
  const pick = (k: number) => (rand() < 1 / 3 ? 0 : (rand() * 2 - 1) * k);
  return { ...NO_MOVE, x: pick(500), y: pick(500), z: pick(500), turnX: pick(180), turnY: pick(180), turnZ: pick(180), pivotX: pick(200), pivotY: pick(200), pivotZ: pick(200) };
}

test("seeded: 2,000 chains of Moves put the body's frame where the Move preview's arithmetic puts points (FISSION_SEED)", () => {
  const rand = seeded(SEED);
  for (let i = 0; i < 2000; i++) {
    const moves = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => randomMove(rand));
    const frame = bodyFrame(movedBy(moves.flatMap(moveMotions)));
    const map = carried(undefined, frame ?? undefined);
    const p: Vec3 = [(rand() * 2 - 1) * 300, (rand() * 2 - 1) * 300, (rand() * 2 - 1) * 300];
    // movedPoint (move-tool.ts) turns about X, Y then Z with its own cos and sin, then shifts: a separate path to the same place.
    const want = moves.reduce<readonly number[]>((q, v) => movedPoint(q, v), p);
    const d = moves.reduce<readonly number[]>((q, v) => movedPoint(q, v, true), [0.6, 0, 0.8]);
    const got = map ? map(p, false) : p;
    near(got, want, `seed ${SEED} chain ${i} point`, 1e-9 * 2000);
    near(map ? map([0.6, 0, 0.8], true) : [0.6, 0, 0.8], d, `seed ${SEED} chain ${i} direction`, 1e-12 * 50);
  }
});

test("seeded: 2,000 sketches on random faces carried by random edits land where the edit moves the face, and the same body frame changes nothing (FISSION_SEED)", () => {
  const rand = seeded(SEED + 1);
  let same = 0;
  for (let i = 0; i < 2000; i++) {
    const then = bodyFrame(movedBy(moveMotions(randomMove(rand)))) ?? undefined;
    const now = rand() < 0.1 ? then : (bodyFrame(movedBy(moveMotions(randomMove(rand)))) ?? undefined);
    // A drawn frame on a random plane: rule 8's origin is the plane's nearest point to the world's origin.
    const n = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const drawn = squared(plane([0, 0, 0], [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], n));
    if (drawn === null) continue;
    const h = (rand() * 2 - 1) * 400;
    const d0 = plane(drawn.normal.map((x) => x * h), drawn.xAxis, drawn.normal);
    const carry = carried(then, now);
    if (carry === null) {
      // Not moved since drawn: exactly as before 35e2h, the face where it was.
      assert.deepEqual(frameNow(d0, d0.normal, d0.origin, carry), frameNow(d0, d0.normal, d0.origin), `seed ${SEED + 1} sketch ${i}`);
      same++;
      continue;
    }
    // The face is where the edit took it: its outward normal (here the drawn one) and a point carried rigidly.
    const want = plane(carry(d0.origin, false), carry(d0.xAxis, true), carry(d0.normal, true));
    const q = carry([d0.origin[0] + 13 * d0.xAxis[0], d0.origin[1] + 13 * d0.xAxis[1], d0.origin[2] + 13 * d0.xAxis[2]], false);
    nearPlane(frameNow(d0, want.normal, q, carry), want, `seed ${SEED + 1} sketch ${i}`, 1e-9 * 2000);
  }
  assert.ok(same > 100, `the unmoved branch was tried (${same})`);
});
