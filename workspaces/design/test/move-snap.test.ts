// Move's snap (step 35e2d, move-snap.ts), worked by hand: a box stacked on
// another, a box laid top to top (half a turn about X), side to side (half
// a turn about Y), an edge laid along an upright edge (−90° about Y), a
// cylinder's rim on another's, the refusals, the turn kept from the boxes,
// the parallel limit at 0.9× and 1.1×, and an edited Move's ends taken back
// through the Moves after it. Seeded: 2,000 random snaps land exactly and
// turn least; 2,000 random turns read back as angles. The same snaps on
// the real kernel are in packages/testing/journeys/move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { NO_MOVE, insertMove, type MoveValues } from "../src/move.ts";
import { movedPoint } from "../src/move-tool.ts";
import { SNAP_CURVED_FACE, PARALLEL, SNAP_NO_FLAT, snapAngle, snapEnds, snappedValues, snapPart, turnAngles, turnBetween, turnMatrix, type SnapPart } from "../src/move-snap.ts";
import { insertPreset, partDocument } from "../src/document.ts";
import { boxView, cylinderView } from "./views.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const close = (got: readonly number[], want: readonly number[], what: string, eps = 1e-12) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= eps, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const turnsOf = (m: MoveValues) => [m.turnX, m.turnY, m.turnZ];
const shiftOf = (m: MoveValues) => [m.x, m.y, m.z];
const values = (r: ReturnType<typeof snappedValues>) => {
  assert.ok("values" in r, JSON.stringify(r));
  return r.values;
};
const part = (r: ReturnType<typeof snapPart>) => {
  assert.ok("part" in r, JSON.stringify(r));
  return r.part;
};

/** A w × d × h box's view with its faces' centroids and normals (BOX_VIEW's order: bottom, top, front, back, left, right). */
function box(w: number, d: number, h: number): BodyView {
  const c = [w / 2, d / 2, h / 2];
  return {
    ...boxView(w, d, h),
    face_centroids: [[c[0], c[1], 0], [c[0], c[1], h], [c[0], 0, c[2]], [c[0], d, c[2]], [0, c[1], c[2]], [w, c[1], c[2]]],
    face_normals: [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]],
  };
}
/** A cylinder of radius r and height h standing on the origin: bottom, top, side. */
function cylinder(r: number, h: number): BodyView {
  return { ...cylinderView(r, h), face_centroids: [[0, 0, 0], [0, 0, h], [0, 0, h / 2]], face_normals: [[0, 0, -1], [0, 0, 1], null] };
}
const big = box(40, 30, 20); // the box landed on
const small = box(10, 10, 10); // the box moved, turning about its middle (5, 5, 5)
const pivot = { pivotX: 5, pivotY: 5, pivotZ: 5 };

test("by hand: a 10 mm cube's bottom on a 40 × 30 × 20 box's top: no turn, centre on centre", () => {
  // The cube's bottom is centred (5, 5, 0) facing −Z; the big top (20, 15, 20) facing +Z: already facing each other,
  // so no turn, and the shift is (20, 15, 20) − (5, 5, 0) = (15, 10, 20).
  const m = values(snappedValues(v(pivot), part(snapPart(small, "face", 0)), part(snapPart(big, "face", 1))));
  assert.deepEqual(turnsOf(m), [0, 0, 0]);
  assert.deepEqual(shiftOf(m), [15, 10, 20]);
  assert.deepEqual([m.pivotX, m.pivotY, m.pivotZ], [5, 5, 5], "the pivot stays");
});

test("by hand: top on top turns the cube over, half a turn about X", () => {
  // Both tops face +Z: the cube's must face −Z. They lie along one line, so half a turn about the world axis most
  // square to +Z, X (X and Y tie at 0; X first). Turned 180° about X through (5, 5, 5), (y, z) → (−y, −z) about it:
  // the top's centre (5, 5, 10) goes to (5, 5, 0). Shift (20, 15, 20) − (5, 5, 0) = (15, 10, 20).
  const m = values(snappedValues(v(pivot), part(snapPart(small, "face", 1)), part(snapPart(big, "face", 1))));
  assert.deepEqual(turnsOf(m), [180, 0, 0]);
  assert.deepEqual(shiftOf(m), [15, 10, 20]);
});

test("by hand: right side on right side is half a turn about Y, read as 180° about Y (not 180° about X and Z)", () => {
  // Both face +X. The axis most square to +X: Y (Y and Z tie at 0; Y first). 180° about Y, (z, x) → (−z, −x) about
  // the pivot: the right face's centre (10, 5, 5) goes to (0, 5, 5). The big right side's centre is (40, 15, 10):
  // shift (40, 10, 5), so the cube stands outside the box, x from 40 to 50. The same turn is also 180° about X then
  // 180° about Z (360° in all); the smaller, 180° about Y alone, is the one shown.
  const m = values(snappedValues(v(pivot), part(snapPart(small, "face", 5)), part(snapPart(big, "face", 5))));
  assert.deepEqual(turnsOf(m), [0, 180, 0]);
  assert.deepEqual(shiftOf(m), [40, 10, 5]);
});

test("by hand: a straight edge laid along an upright edge, −90° about Y, middle on middle", () => {
  // The cube's edge 4 runs (0, 0, 10) → (10, 0, 10): along +X, middle (5, 0, 10). The big box's edge 8 runs
  // (40, 0, 0) → (40, 0, 20): along +Z, middle (40, 0, 10). +X to +Z is 90° about X × Z = −Y, i.e. −90° about Y
  // (about Y counter-clockwise takes Z to X, so the other way takes X to Z). Through (5, 5, 5): the middle,
  // (0, −5, 5) from the pivot, goes to (−5, −5, 0), the point (0, 0, 5). Shift (40, 0, 10) − (0, 0, 5) = (40, 0, 5).
  const m = values(snappedValues(v(pivot), part(snapPart(small, "edge", 4)), part(snapPart(big, "edge", 8))));
  assert.deepEqual(turnsOf(m), [0, -90, 0]);
  assert.deepEqual(shiftOf(m), [40, 0, 5]);
});

test("by hand: an edge running the other way along the target is not turned round", () => {
  // The cube's edge 3 runs (0, 0, 0) → (10, 0, 0), along +X. A target line along (1, 1, 0)/√2 is 45° about Z away;
  // the same line given as (−1, −1, 0)/√2 is 135° away the other way round, but it is the same line, so it is
  // laid along it by the smaller 45° too: the sign of a line's direction never adds half a turn.
  const r = Math.SQRT1_2;
  const along: SnapPart = { kind: "line", point: [0, 15, 0], direction: [r, r, 0] };
  const back: SnapPart = { kind: "line", point: [0, 15, 0], direction: [-r, -r, 0] };
  const from = part(snapPart(small, "edge", 3));
  const a = values(snappedValues(v(pivot), from, along));
  const b = values(snappedValues(v(pivot), from, back));
  assert.deepEqual(turnsOf(a), [0, 0, 45]);
  assert.deepEqual(turnsOf(b), [0, 0, 45], "the same line: still 45° about Z");
  assert.deepEqual(shiftOf(a), shiftOf(b));
});

test("by hand: a ⌀10 cylinder's bottom rim on a ⌀20 cylinder's top rim, centre on centre", () => {
  // The small one's bottom rim (edge 0) is centred (0, 0, 0), the flat face beside it the bottom, facing −Z; the
  // big one's top rim (edge 1) centred (0, 0, 20), beside the top facing +Z. No turn; the shift is (0, 0, 20).
  const m = values(snappedValues(v({}), part(snapPart(cylinder(5, 10), "edge", 0)), part(snapPart(cylinder(10, 20), "edge", 1))));
  assert.deepEqual(turnsOf(m), [0, 0, 0]);
  assert.deepEqual(shiftOf(m), [0, 0, 20]);
});

test("refused: a curved face, a round edge with no flat face beside it, and a face onto an edge", () => {
  assert.deepEqual(snapPart(cylinder(5, 10), "face", 2), { refused: SNAP_CURVED_FACE });
  const sphereRim = { ...cylinder(5, 10), face_normals: [null, null, null] };
  assert.deepEqual(snapPart(sphereRim, "edge", 0), { refused: SNAP_NO_FLAT });
  const face = part(snapPart(small, "face", 0));
  assert.deepEqual(snappedValues(v({}), face, part(snapPart(big, "edge", 0))), { refused: "A flat face lands only on a flat face: pick one on another body." });
  assert.deepEqual(snappedValues(v({}), part(snapPart(small, "edge", 0)), face), { refused: "A straight edge lands only on a straight edge: pick one on another body." });
  assert.deepEqual(snappedValues(v({}), part(snapPart(cylinder(5, 10), "edge", 0)), part(snapPart(small, "edge", 0))), { refused: "A round edge lands only on a round edge: pick one on another body." });
});

test("by hand: the turn the boxes already hold is kept about the snapped direction", () => {
  // The cube already turned 30° about Z: its bottom still faces −Z, so landing it on the big top needs no more turn.
  // 30° stays; the bottom's centre (5, 5, 0) is on the Z axis through the pivot, so turning leaves it, and the
  // shift is (15, 10, 20) as before.
  const m = values(snappedValues(v({ ...pivot, turnZ: 30, x: 7 }), part(snapPart(small, "face", 0)), part(snapPart(big, "face", 1))));
  assert.deepEqual(turnsOf(m), [0, 0, 30]);
  close(shiftOf(m), [15, 10, 20], "shift", 1e-9);
});

test("the parallel limit: directions 0.9 × PARALLEL apart count as one line, 1.1 × apart are turned between", () => {
  const off = (s: number): [number, number, number] => [s, 0, Math.sqrt(1 - s * s)];
  // 0.9e-12 off +Z: no turn at all (the identity).
  assert.deepEqual(turnBetween([0, 0, 1], off(0.9 * PARALLEL)).flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // 1.1e-12 off: a turn about Y of 1.1e-12 rad, whose off-diagonal sine shows it.
  const r = turnBetween([0, 0, 1], off(1.1 * PARALLEL));
  assert.ok(Math.abs(r[0][2] - 1.1 * PARALLEL) < 1e-20, `${r[0][2]}`);
  // Opposite, 0.9e-12 off −Z: exactly half a turn about X (the fixed axis); 1.1e-12 off: about Y, the cross product's.
  const flip = turnBetween([0, 0, 1], [0.9 * PARALLEL, 0, -1]);
  close(flip.flat(), [1, 0, 0, 0, -1, 0, 0, 0, -1], "about X");
  const turn = turnBetween([0, 0, 1], [1.1 * PARALLEL, 0, -Math.sqrt(1 - 1.21 * PARALLEL * PARALLEL)]);
  close(turn[1], [0, 1, 0], "about Y keeps Y");
});

test("by hand: angles rounded to 1e-12°: 90.00000000000001 is 90, 90.000000001 stays", () => {
  assert.equal(snapAngle(90.00000000000001), 90);
  assert.equal(snapAngle(90.000000001), 90.000000001);
  assert.equal(Object.is(snapAngle(-1e-14), -0), false, "no −0 in a box");
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
const randomUnit = (rand: () => number): [number, number, number] => {
  for (;;) {
    const p = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const n = Math.hypot(p[0], p[1], p[2]);
    if (n > 0.1 && n <= 1) return [p[0] / n, p[1] / n, p[2] / n];
  }
};
const axisOr = (rand: () => number) => (rand() < 0.3 ? (([[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]] as const)[Math.floor(rand() * 6)].slice() as [number, number, number]) : randomUnit(rand));

test("seeded: 2,000 rotations read back as Move angles give the same rotation, each in (−180°, 180°]", () => {
  const rand = seeded(352);
  for (let n = 0; n < 2000; n++) {
    // Near ±90° about Y a fifth of the time, where the angles are hardest to read.
    const m = v({ turnX: (rand() - 0.5) * 360, turnY: rand() < 0.2 ? (rand() < 0.5 ? -90 : 90) + (rand() - 0.5) * 1e-6 : (rand() - 0.5) * 360, turnZ: (rand() - 0.5) * 360 });
    const back = turnAngles(turnMatrix(m));
    back.forEach((a) => assert.ok(a > -180 && a <= 180, `angle ${a}`));
    close(turnMatrix(v({ turnX: back[0], turnY: back[1], turnZ: back[2] })).flat(), turnMatrix(m).flat(), `rotation ${n}`, 1e-12);
  }
});

test("seeded: 2,000 random snaps land the point on the point, the direction against (or along) the other, by the least turn", () => {
  const rand = seeded(353);
  const kinds = ["face", "line", "circle"] as const;
  for (let n = 0; n < 2000; n++) {
    const kind = kinds[n % 3];
    const make = (): SnapPart => {
      const point: [number, number, number] = [(rand() - 0.5) * 2000, (rand() - 0.5) * 2000, (rand() - 0.5) * 2000];
      return kind === "line" ? { kind, point, direction: axisOr(rand) } : { kind, point, normal: axisOr(rand) };
    };
    const start = v({ x: (rand() - 0.5) * 100, turnX: rand() < 0.5 ? 0 : (rand() - 0.5) * 360, turnY: rand() < 0.5 ? 0 : (rand() - 0.5) * 360, turnZ: (rand() - 0.5) * 360, pivotX: (rand() - 0.5) * 1000, pivotY: rand() * 100, pivotZ: rand() * 100 });
    const [from, to] = [make(), make()];
    const m = values(snappedValues(start, from, to));
    // The point lands within a picometre per metre (1e-9 mm rounding plus 1e-12° on points up to ~3 m from the pivot).
    close(movedPoint(from.point, m), to.point, `point ${n}`, 1e-8);
    const dir = (p: SnapPart) => (p.kind === "line" ? p.direction : p.normal);
    const got = movedPoint(dir(from), m, true);
    const was = movedPoint(dir(from), start, true);
    const t = dir(to);
    const want = kind === "line" ? (was[0] * t[0] + was[1] * t[1] + was[2] * t[2] < 0 ? t.map((x) => -x) : t) : t.map((x) => -x);
    close(got, want, `direction ${n}`, 1e-11);
    // The least turn: the turn added (now · startᵀ) is by the angle between where the direction was and where it went.
    const added = turnMatrix(m).map((row) => [0, 1, 2].map((j) => row.reduce((s, x, k) => s + x * turnMatrix(start)[j][k], 0)));
    const angle = Math.acos(Math.max(-1, Math.min(1, (added[0][0] + added[1][1] + added[2][2] - 1) / 2)));
    const between = Math.acos(Math.max(-1, Math.min(1, was[0] * want[0] + was[1] * want[1] + was[2] * want[2])));
    // acos is steep near 0 and π, so the angles agree to about √(1e-12).
    assert.ok(Math.abs(angle - between) < 2e-6, `least turn ${n}: ${angle} vs ${between}`);
  }
});

test("by hand: an edited Move's ends are taken back through the later Move of the same body and out of itself", () => {
  // Move 1 shifts the box (feature-2's preset) by (100, 0, 0); Move 2 after it shifts it by (0, 50, 0). Seen on
  // screen the box's bottom centre is (5 + 100, 5 + 50, 0) = (105, 55, 0): taken back through Move 2 and out of
  // Move 1 it is (5, 5, 0), where the box was made. A target seen at (20, 65, 20) is taken back through Move 2
  // only, to (20, 15, 20): landing there under Move 1, Move 2 then carries the box on to where the target is seen.
  let doc = insertPreset(partDocument("box", 10, 10, 10), "box", 10, 10, 10).doc;
  const body = doc.timeline.features.at(-1)!.id;
  let first: string;
  ({ doc, id: first } = insertMove(doc, [body], v({ x: 100 })));
  ({ doc } = insertMove(doc, [body], v({ y: 50 })));
  const results = Object.fromEntries(doc.timeline.features.map((f) => [f.id, { status: "built" }]));
  const from: SnapPart = { kind: "face", point: [105, 55, 0], normal: [0, 0, -1] };
  const to: SnapPart = { kind: "face", point: [20, 65, 20], normal: [0, 0, 1] };
  const ends = snapEnds(doc, results, first, body, from, to);
  close(ends.from.point, [5, 5, 0], "from");
  close(ends.to.point, [20, 15, 20], "to");
  // A Move that did not build moved nothing: only the later Move is taken back.
  const failed = { ...results, [first]: { status: "failed" } };
  close(snapEnds(doc, failed, first, body, from, to).from.point, [105, 5, 0], "failed Move");
  // A new Move (no id) takes nothing back.
  close(snapEnds(doc, results, null, body, from, to).from.point, [105, 55, 0], "new Move");
});
