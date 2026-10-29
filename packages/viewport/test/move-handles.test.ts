// 35e2c: the Move tool's arrows and rings in the view (move-handles.ts);
// from Ben's ask (2026-10-29) Move's arrows and Rotate's grips, placed each
// frame so no two press areas overlap (hand-worked placings, the limits at
// 0.9× and 1.1×, 6,000 seeded views). Where each is drawn (worked by hand), which one a press is on (nearest
// wins; the grab distance at 0.9× and 1.1×), the angle round a ring where
// the pointer's ray meets its plane (worked by hand for each axis, the
// side-on limit at 0.9× and 1.1×, 2,000 seeded points built on the ring's
// plane at a known angle and seen from a random camera), and turns added
// up past a whole turn (by hand, and 500 seeded random walks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_PIECES, ARROW_SHOWN, EDGE_ON, gripPoint, handleAxis, handleNear, isRing, KIND_HANDLES, lineGap, MOVE_GRAB_PX, MOVE_HANDLES, MOVE_PX, placedLine, placeHandles, RING_SHOWN, ringAngle, ringBasis, segmentGap, turnBetween, type Placed } from "../src/move-handles.ts";

type Vec3 = [number, number, number];

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
  const at = (p: Placed) => placedLine([1, 2, 3], 0.5, p);
  // The X arrow runs from 58 px to 136 px along +X: 29 mm to 68 mm from the centre, so x = 30 to 69; the other way, x = −28 to −67.
  assert.deepEqual(at({ handle: "x", sign: 1, quarter: 0 }), [[30, 2, 3], [69, 2, 3]]);
  assert.deepEqual(at({ handle: "x", sign: -1, quarter: 0 }), [[-28, 2, 3], [-67, 2, 3]]);
  // The Z arrow likewise along +Z: z = 3 + 29 = 32 to 3 + 68 = 71.
  assert.deepEqual(at({ handle: "z", sign: 1, quarter: 0 }), [[1, 2, 32], [1, 2, 71]]);
  // The Z grip on quarter 0: the 72 px = 36 mm circle in XY, its arc from 22.5° to 67.5° with the dot (the middle point) at 45°:
  // (1 + 36 cos 45°, 2 + 36 sin 45°, 3) = (26.456, 27.456, 3); its first point at 22.5°: (1 + 33.26, 2 + 13.78, 3).
  const z = at({ handle: "turnZ", sign: 1, quarter: 0 });
  assert.equal(z.length, ARC_PIECES + 1);
  const r = 36 * Math.SQRT1_2;
  z[ARC_PIECES / 2].forEach((x, k) => assert.ok(near(x, [1 + r, 2 + r, 3][k]), `dot ${z[ARC_PIECES / 2]}`));
  z[0].forEach((x, k) => assert.ok(near(x, [1 + 36 * Math.cos(Math.PI / 8), 2 + 36 * Math.sin(Math.PI / 8), 3][k]), `start ${z[0]}`));
  // The X grip on quarter 1: about X, u = +Y and v = +Z, the middle at 135°: (1, 2 − 25.456, 3 + 25.456).
  const x = at({ handle: "turnX", sign: 1, quarter: 1 })[ARC_PIECES / 2];
  x.forEach((c, k) => assert.ok(near(c, [1, 2 - r, 3 + r][k]), `X grip's dot ${x}`));
  // Every point of a grip is on its circle: 36 mm from the centre, in its plane.
  for (const p of z) assert.ok(near(Math.hypot(p[0] - 1, p[1] - 2), 36) && p[2] === 3);
  // The grip point a press aims at: an arrow's middle, a grip's dot.
  assert.deepEqual(gripPoint([{ x: 0, y: 0 }, { x: 10, y: 4 }], "x"), { x: 5, y: 2 });
  const arc = Array.from({ length: ARC_PIECES + 1 }, (_, i) => ({ x: i, y: 0 }));
  assert.deepEqual(gripPoint(arc, "turnY"), { x: ARC_PIECES / 2, y: 0 });
});

test("the gap between two lines on screen, by hand", () => {
  // Crossing: 0. Parallel 3 apart: 3. End to end along a line, 4 apart: 4. A point 5 above the middle of a segment: 5.
  assert.equal(segmentGap({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), 0);
  assert.equal(segmentGap({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }, { x: 10, y: 3 }), 3);
  assert.equal(segmentGap({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 14, y: 0 }, { x: 20, y: 0 }), 4);
  assert.equal(segmentGap({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }), 5);
  // Lines of points: the least over every pair of pieces; a corner 3-4-5 from a point.
  assert.equal(lineGap([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], [{ x: 13, y: 4 }, { x: 20, y: 4 }]), 3);
  assert.equal(lineGap([{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 3, y: 4 }, { x: 3, y: 4 }]), 5);
});

/** A camera looking along `toward` at the centre from `distance` mm, as a projection to screen pixels (fov 45°, 800 px tall) and the line of sight. */
function camera(toward: readonly number[], distance: number, centre: Vec3 = [0, 0, 0]) {
  const len = Math.hypot(...toward);
  const d = toward.map((x) => x / len) as unknown as Vec3;
  const up: Vec3 = Math.abs(d[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: Vec3): Vec3 => a.map((x) => x / Math.hypot(...a)) as unknown as Vec3;
  const right = unit(cross(d, up));
  const top = cross(right, d);
  const eye = centre.map((c, k) => c - d[k] * distance);
  const focal = 400 / Math.tan((22.5 * Math.PI) / 180); // px: half the 800 px height over tan(fov/2)
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const project = (p: Vec3) => {
    const q = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const depth = dot(q, d);
    if (!(depth > 1e-6)) return null;
    return { x: 640 + (focal * dot(q, right)) / depth, y: 400 - (focal * dot(q, top)) / depth };
  };
  // One CSS pixel in mm at the centre: distance / focal.
  return { project, sight: d, pixel: distance / focal };
}

const placed = (kind: "move" | "rotate", toward: readonly number[], reach = MOVE_GRAB_PX.touch) => {
  const c = camera(toward, 500);
  return placeHandles(kind, [0, 0, 0], c.pixel, c.sight, c.project, reach);
};

test("hand-worked placings: the home view, straight down, and the view where X and Y lie on each other", () => {
  // Looking down (−1, −1, −1) (the camera above the +X +Y +Z corner): every arrow along its axis. With a mouse every
  // grip sits on quarter 0, the arc between +u and +v, which faces the camera for each circle (u and v both +).
  assert.deepEqual(placed("move", [-1, -1, -1]), [{ handle: "x", sign: 1, quarter: 0 }, { handle: "y", sign: 1, quarter: 0 }, { handle: "z", sign: 1, quarter: 0 }]);
  const mouse = MOVE_GRAB_PX.mouse;
  assert.deepEqual(placed("rotate", [-1, -1, -1], mouse), [{ handle: "turnX", sign: 1, quarter: 0 }, { handle: "turnY", sign: 1, quarter: 0 }, { handle: "turnZ", sign: 1, quarter: 0 }]);
  // Those near arcs lean towards the camera, so on screen they shrink to √(2/3) of 72 px from the centre and crowd
  // a finger's 48 px gap; with touch they go to the next arcs tried, whose middles are square to the line of sight
  // ((0, −1, 1) · (1, 1, 1) = 0 for X; quarters 1 and 3 tie at 0, and 1 is tried first), so all three lie flat on
  // screen, 72 px out and a third of a turn apart: dots 72√3 = 125 px apart.
  assert.deepEqual(placed("rotate", [-1, -1, -1]).map((p) => p.quarter), [1, 1, 1]);
  // From the −X −Y −Z corner instead a mouse's grips move to quarter 2 (between −u and −v), the near side.
  assert.deepEqual(placed("rotate", [1, 1, 1], mouse).map((p) => p.quarter), [2, 2, 2]);
  // Straight down Z: the Z arrow points at the camera and the X and Y circles are side-on, so each is left out.
  assert.deepEqual(placed("move", [0, 0, -1]).map((p) => p.handle), ["x", "y"]);
  assert.deepEqual(placed("rotate", [0, 0, -1]).map((p) => p.handle), ["turnZ"]);
  // Looking along (−1, 1, 0) (the camera off the +X −Y edge): X and Y both lie along the screen's same line,
  // x − (x·d)d = (½, ½, 0) = y − (y·d)d, so the Y arrow turns the other way and the two point apart.
  assert.deepEqual(placed("move", [-1, 1, 0]), [{ handle: "x", sign: 1, quarter: 0 }, { handle: "y", sign: -1, quarter: 0 }, { handle: "z", sign: 1, quarter: 0 }]);
});

test("a handle the camera looks along is left out: 0.9× and 1.1× of ARROW_SHOWN and RING_SHOWN", () => {
  // The X arrow shows the part of its length across the line of sight: with sight = (√(1 − s²), 0, −s) that part is s,
  // so s = 0.9 · 0.3 hides it and 1.1 · 0.3 keeps it, whichever way the arrow points and however near the camera.
  const along = (s: number) => [Math.sqrt(1 - s * s), 0, -s];
  const shown = (kind: "move" | "rotate", toward: readonly number[], h: string) => placed(kind, toward).some((p) => p.handle === h);
  assert.equal(shown("move", along(0.9 * ARROW_SHOWN), "x"), false);
  assert.equal(shown("move", along(1.1 * ARROW_SHOWN), "x"), true);
  // The Z grip's circle seen with |sight · Z| = 0.9 · 0.2: left out; 1.1 · 0.2: shown.
  const tilt = (s: number) => [Math.sqrt(1 - s * s) * Math.SQRT1_2, Math.sqrt(1 - s * s) * Math.SQRT1_2, -s];
  assert.equal(shown("rotate", tilt(0.9 * RING_SHOWN), "turnZ"), false);
  assert.equal(shown("rotate", tilt(1.1 * RING_SHOWN), "turnZ"), true);
});

test("the gap rule at 0.9× and 1.1×: arrows keep their way while their lines are 2 · reach apart, and turn once they are nearer", () => {
  // From (−1, −0.3, −0.6) the three arrows along their axes are some gap g apart on screen (the least of the three pairs).
  const toward = [-1, -0.3, -0.6];
  const c = camera(toward, 500);
  const lines = (["x", "y", "z"] as const).map((handle) => placedLine([0, 0, 0], c.pixel, { handle, sign: 1, quarter: 0 }).map((p) => c.project(p)!));
  const g = Math.min(lineGap(lines[0], lines[1]), lineGap(lines[0], lines[2]), lineGap(lines[1], lines[2]));
  assert.ok(g > 10, `g ${g}`);
  // Reach g / 2 / 1.1: 2 · reach = g / 1.1, under g: kept as they are. Reach 1.1 · g / 2: over g: something changes.
  assert.ok(placed("move", toward, g / 2 / 1.1).every((p) => p.sign === 1));
  const tight = placed("move", toward, (1.1 * g) / 2);
  assert.ok(tight.some((p) => p.sign === -1) || tight.length < 3, JSON.stringify(tight));
});

test("seeded: 6,000 views, near and far, along the axes and in their planes too: no two press areas ever overlap, and nothing looked along is shown", () => {
  const rand = seeded(20261029);
  const views: number[][] = [];
  // The awkward ones first: along each axis, in each coordinate plane, along each diagonal.
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [1, -1, 1]]) views.push(v, v.map((x) => -x));
  while (views.length < 3000) {
    const z = 2 * rand() - 1;
    const t = 2 * Math.PI * rand();
    views.push([Math.sqrt(1 - z * z) * Math.cos(t), Math.sqrt(1 - z * z) * Math.sin(t), z]);
  }
  let shownAll = 0;
  let could = 0;
  for (const [n, toward] of views.entries()) {
    for (const kind of ["move", "rotate"] as const) {
      const reach = n % 2 === 0 ? MOVE_GRAB_PX.touch : MOVE_GRAB_PX.mouse;
      const centre: Vec3 = [rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50];
      const cc = camera(toward, 60 + rand() * 2000, centre);
      const got = placeHandles(kind, centre, cc.pixel, cc.sight, cc.project, reach);
      assert.equal(new Set(got.map((p) => p.handle)).size, got.length, `view ${n}: a handle placed twice`);
      for (const p of got) assert.ok(KIND_HANDLES[kind].includes(p.handle), `view ${n}: ${p.handle} is not ${kind}'s`);
      const lines = got.map((p) => placedLine(centre, cc.pixel, p).map((q) => cc.project(q)!));
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++) {
          const gap = lineGap(lines[i], lines[j]);
          assert.ok(gap >= 2 * reach, `view ${n} (${toward.map((x) => x.toFixed(3))}), ${kind}: ${got[i].handle} and ${got[j].handle} only ${gap.toFixed(2)} px apart`);
        }
      for (const [i, p] of got.entries()) {
        const axis = handleAxis(p.handle);
        if (isRing(p.handle)) assert.ok(Math.abs(cc.sight[axis]) >= RING_SHOWN, `view ${n}: ${p.handle} side-on`);
        else assert.ok(Math.sqrt(1 - cc.sight[axis] ** 2) >= ARROW_SHOWN, `view ${n}: ${p.handle} looked along`);
      }
      // How often every handle that could be shown is: counted, so a change that leaves handles out shows here.
      const eligible = KIND_HANDLES[kind].filter((h) => (isRing(h) ? Math.abs(cc.sight[handleAxis(h)]) >= RING_SHOWN : Math.sqrt(1 - cc.sight[handleAxis(h)] ** 2) >= ARROW_SHOWN + 0.05)).length;
      could++;
      if (got.length >= eligible) shownAll++;
    }
  }
  assert.ok(shownAll / could > 0.97, `every handle that could be shown was in ${((100 * shownAll) / could).toFixed(1)}% of views`);
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
