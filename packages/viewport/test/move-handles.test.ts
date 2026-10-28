// 35e2c: the Move tool's arrows and rings in the view (move-handles.ts).
// Where each is drawn (worked by hand), which one a press is on (nearest
// wins; the grab distance at 0.9× and 1.1×), the angle round a ring where
// the pointer's ray meets its plane (worked by hand for each axis, the
// side-on limit at 0.9× and 1.1×, 2,000 seeded points built on the ring's
// plane at a known angle and seen from a random camera), and turns added
// up past a whole turn (by hand, and 500 seeded random walks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_ON, handleAxis, handleLines, handleNear, isRing, MOVE_HANDLES, MOVE_PX, RING_PIECES, ringAngle, ringBasis, turnBetween } from "../src/move-handles.ts";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const DEG = Math.PI / 180;

/** A small seeded generator (mulberry32), so every run draws the same cases. */
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

test("the handles: three arrows then three rings, each on its own axis", () => {
  assert.deepEqual(MOVE_HANDLES, ["x", "y", "z", "turnX", "turnY", "turnZ"]);
  assert.deepEqual(MOVE_HANDLES.map(handleAxis), [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(MOVE_HANDLES.map(isRing), [false, false, false, true, true, true]);
});

test("each ring's basis by hand: (u, v) with u × v along the axis, so u towards v is counter-clockwise looking down it", () => {
  // About X: Y × Z = X. About Y: Z × X = Y. About Z: X × Y = Z.
  assert.deepEqual(ringBasis(0), [[0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(ringBasis(1), [[0, 0, 1], [1, 0, 0]]);
  assert.deepEqual(ringBasis(2), [[1, 0, 0], [0, 1, 0]]);
});

test("where the handles are drawn, by hand: centre (1, 2, 3), half a millimetre to the pixel", () => {
  const lines = handleLines([1, 2, 3], 0.5);
  const at = (h: string) => lines.find((l) => l.handle === h)!.points;
  // The X arrow runs from 58 px to 110 px along +X: 29 mm to 55 mm from the centre, so x = 30 to 56.
  assert.deepEqual(at("x"), [[30, 2, 3], [56, 2, 3]]);
  // The Z arrow likewise along +Z: z = 3 + 29 = 32 to 3 + 55 = 58.
  assert.deepEqual(at("z"), [[1, 2, 32], [1, 2, 58]]);
  // The Z ring has radius 45 px = 22.5 mm about the centre, starting on u = +X: (23.5, 2, 3); a quarter round (12 of 48 pieces) on v = +Y: (1, 24.5, 3).
  const ring = at("turnZ");
  assert.equal(ring.length, RING_PIECES + 1);
  ring[0].forEach((x, k) => assert.ok(near(x, [23.5, 2, 3][k]), `start ${ring[0]}`));
  ring[12].forEach((x, k) => assert.ok(near(x, [1, 24.5, 3][k]), `quarter ${ring[12]}`));
  ring[RING_PIECES].forEach((x, k) => assert.ok(near(x, ring[0][k]), "closed"));
  // The X ring starts on +Y and a quarter round is on +Z: (1, 2, 25.5).
  at("turnX")[12].forEach((x, k) => assert.ok(near(x, [1, 2, 25.5][k]), `X ring quarter ${at("turnX")[12]}`));
  // The arrows start outside the rings: no arrow point is within a ring's radius of the centre.
  assert.ok(MOVE_PX.arrowFrom > MOVE_PX.ring);
});

test("which handle a press is on: the nearest within the grab distance; 0.9× and 1.1× of it", () => {
  const r = 10;
  // An arrow on screen from (100, 100) to (200, 100), and a piece of a ring from (145, 100) up to (145, 60).
  const lines = [
    { handle: "x" as const, screen: [{ x: 100, y: 100 }, { x: 200, y: 100 }] },
    { handle: "turnZ" as const, screen: [{ x: 145, y: 100 }, { x: 145, y: 60 }] },
  ];
  // 0.9 × 10 = 9 px below the arrow at x = 180 (the ring's piece is 36 px off): the arrow.
  assert.equal(handleNear(lines, { x: 180, y: 109 }, r), "x");
  // 1.1 × 10 = 11 px below: nothing.
  assert.equal(handleNear(lines, { x: 180, y: 111 }, r), null);
  // (147, 99): 1 px from the arrow, 2 px from the ring's line: the arrow, the nearer.
  assert.equal(handleNear(lines, { x: 147, y: 99 }, r), "x");
  // (146, 95): 5 px from the arrow, 1 px from the ring's line, both within reach: the ring, the nearer, though listed second.
  assert.equal(handleNear(lines, { x: 146, y: 95 }, r), "turnZ");
  // (146, 80): 20 px from the arrow, 1 px from the ring's line: the ring.
  assert.equal(handleNear(lines, { x: 146, y: 80 }, r), "turnZ");
  // A point that can't be drawn (NaN) is no line.
  assert.equal(handleNear([{ handle: "y", screen: [{ x: NaN, y: 0 }, { x: 10, y: 0 }] }], { x: 5, y: 0 }, r), null);
});

test("the angle round a ring, by hand for each axis", () => {
  // Looking straight down Z from (3, 4, 10): the ray meets z = 0 at (3, 4, 0), atan2(4, 3) = 53.13° from +X towards +Y.
  assert.ok(near(ringAngle([3, 4, 10], [0, 0, -1], [0, 0, 0], 2)!, Math.atan2(4, 3)));
  // Looking down X from (10, 0, 5): the ray meets x = 0 at (0, 0, 5), straight along v = +Z from the centre: 90°.
  assert.ok(near(ringAngle([10, 0, 5], [-1, 0, 0], [0, 0, 0], 0)!, Math.PI / 2));
  // Looking down Y from (2, 10, 0) at the ring about Y centred at (1, 0, 0): the ray meets y = 0 at (2, 0, 0), 1 mm along +X from the centre; u is +Z and v is +X, so 90°.
  assert.ok(near(ringAngle([2, 10, 0], [0, -1, 0], [1, 0, 0], 1)!, Math.PI / 2));
  // From below, looking up Z at (−1, 0): 180°, whichever side the camera is on (the angle is the ring's, not the screen's).
  assert.ok(near(Math.abs(ringAngle([-1, 0, -10], [0, 0, 1], [0, 0, 0], 2)!), Math.PI));
  // The plane behind the camera: no angle. The ray through the centre itself: no angle.
  assert.equal(ringAngle([3, 4, 10], [0, 0, 1], [0, 0, 0], 2), null);
  assert.equal(ringAngle([0, 0, 10], [0, 0, -1], [0, 0, 0], 2), null);
});

test("side-on to a ring the angle stops: 0.9× and 1.1× of EDGE_ON", () => {
  // A unit ray whose Z part is s; the rest along X. From (0, 0, 10) it meets z = 0 far out on +X: angle 0.
  const ray = (s: number): [number, number, number] => [Math.sqrt(1 - s * s), 0, -s];
  assert.equal(ringAngle([0, 0, 10], ray(0.9 * EDGE_ON), [0, 0, 0], 2), null);
  assert.ok(near(ringAngle([0, 0, 10], ray(1.1 * EDGE_ON), [0, 0, 0], 2)!, 0));
  assert.equal(ringAngle([0, 0, 10], [0, 0, 0], [0, 0, 0], 2), null, "no ray at all");
});

test("seeded: 2,000 points built on a ring's plane at a known angle, seen from a random camera, give that angle", () => {
  const rand = seeded(20261028);
  let checked = 0;
  for (let n = 0; n < 2000; n++) {
    const axis = (n % 3) as 0 | 1 | 2;
    const centre: [number, number, number] = [0, 1, 2].map(() => (rand() - 0.5) * 200) as [number, number, number];
    const angle = (rand() - 0.5) * 2 * Math.PI;
    const radius = 0.1 + rand() * 50;
    const [u, v] = ringBasis(axis);
    const point = centre.map((c, k) => c + radius * (Math.cos(angle) * u[k] + Math.sin(angle) * v[k]));
    const camera = [0, 1, 2].map(() => (rand() - 0.5) * 400);
    const length = 0.5 + rand(); // any length
    const ray = point.map((p, k) => (p - camera[k]) * length) as [number, number, number];
    const got = ringAngle(camera as [number, number, number], ray, centre, axis);
    const side = Math.abs(ray[axis]) / Math.hypot(...ray);
    if (side <= EDGE_ON) {
      assert.equal(got, null, `case ${n}: side-on`);
      continue;
    }
    assert.ok(got !== null && Math.abs(turnBetween(angle, got)) < 1e-7, `case ${n}: ${got} for ${angle}`);
    checked++;
  }
  assert.ok(checked > 1500, `${checked} checked`);
});

test("turns between two angles the short way, by hand: across where atan2 wraps, and half a turn", () => {
  assert.ok(near(turnBetween(170 * DEG, -170 * DEG), 20 * DEG)); // on past 180°
  assert.ok(near(turnBetween(-170 * DEG, 170 * DEG), -20 * DEG)); // back past 180°
  assert.ok(near(turnBetween(10 * DEG, 30 * DEG), 20 * DEG));
  assert.ok(near(turnBetween(0, Math.PI), Math.PI)); // exactly half a turn counts forwards
  assert.ok(near(turnBetween(Math.PI, 0), Math.PI)); // and so does the way back (−π is π)
});

test("seeded: 500 random walks round a ring add up to the walk's true turn, past whole turns, from wrapped angles alone", () => {
  const rand = seeded(35);
  for (let n = 0; n < 500; n++) {
    let truth = (rand() - 0.5) * 10;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let last = wrap(truth);
    let total = 0;
    let walked = 0;
    for (let k = 0; k < 40; k++) {
      const step = (rand() - 0.5) * 2 * 3; // under π each, as a drag's moves are
      truth += step;
      walked += step;
      const now = wrap(truth);
      total += turnBetween(last, now);
      last = now;
    }
    assert.ok(near(total, walked, 1e-9), `walk ${n}: ${total} vs ${walked}`);
  }
});
