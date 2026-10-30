// UX1b: Extrude in the view. Which closed outline is under the pointer
// (hand-worked shapes with a hole, arcs bulging out and in, a major arc,
// corners on the pointer's row; 2,000 seeded loops against a finely drawn
// polygon), the fill drawn from it, and the drag arrow's maths (closest
// point of the arrow's line to the pointer's ray, worked by hand; the
// along-the-arrow limit at 0.9× and 1.1×; whole-mm snapping).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Loop, Outline, SketchXY } from "@fission/core";
import { ALONG_ARROW, ARROW_PX, FILL_SAG, arcCircle, arcPieces, arrowDistance, arrowLength, insideLoop, insideOutline, loopPoints, snapDistance } from "../src/extrude-pick.ts";

const path = (corners: number[], bulges: number[] = []): Loop => ({ path: { corners, bulges } });
const circle = (x: number, y: number, radius: number): Loop => ({ circle: { center: [x, y], radius } });
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("hand-worked: a 40 × 30 rectangle with a circular hole of radius 5 at its middle", () => {
  const outline: Outline = { outer: path([0, 0, 40, 0, 40, 30, 0, 30]), holes: [circle(20, 15, 5)] };
  assert.equal(insideOutline(outline, [5, 5]), true); // in the rectangle, far from the hole
  assert.equal(insideOutline(outline, [20, 15]), false); // the hole's centre
  assert.equal(insideOutline(outline, [20, 19.9]), false); // 4.9 from the centre: in the hole
  assert.equal(insideOutline(outline, [20, 20.1]), true); // 5.1 from it: in the solid ring
  assert.equal(insideOutline(outline, [41, 15]), false); // right of the rectangle
  assert.equal(insideOutline(outline, [-1, 15]), false);
  assert.equal(insideOutline(outline, [20, 30.5]), false); // above it
  assert.equal(insideOutline(outline, [39.9, 29.9]), true); // just inside the far corner
});

test("hand-worked: a diamond with two corners on the pointer's row counts each once", () => {
  // Corners (0,−10), (10,0), (0,10), (−10,0). From p = (−20, 0) the ray to +x
  // runs through the corners (−10,0) and (10,0). An edge counts when one end
  // is strictly above the row and the other is not: (0,−10)→(10,0) no (both
  // not above), (10,0)→(0,10) yes, meeting the row at x = 10, (0,10)→(−10,0)
  // yes at x = −10, (−10,0)→(0,−10) no. From x = −20 both crossings are to
  // the right: 2, outside. From (0,0) only the one at x = 10: 1, inside.
  const diamond = path([0, -10, 10, 0, 0, 10, -10, 0]);
  assert.equal(insideLoop(diamond, [-20, 0]), false);
  assert.equal(insideLoop(diamond, [0, 0]), true);
  assert.equal(insideLoop(diamond, [20, 0]), false); // both crossings to the left: 0
  assert.equal(insideLoop(diamond, [4.9, 5]), true); // the edge x + y = 10 is at x = 5 on this row
  assert.equal(insideLoop(diamond, [5.1, 5]), false);
});

test("hand-worked: a half disc, its arc bulging out", () => {
  // From (−10,0) to (10,0) straight, then (10,0) back to (−10,0) with bulge
  // 1: a half turn counter-clockwise, so on the right of the chord's
  // direction −x, which is +y: through (0,10), centre (0,0), radius 10.
  const half = path([-10, 0, 10, 0], [0, 1]);
  const c = arcCircle([10, 0], [-10, 0], 1);
  assert.ok(near(c.centre[0], 0) && near(c.centre[1], 0) && near(c.radius, 10));
  assert.equal(insideLoop(half, [0, 5]), true);
  assert.equal(insideLoop(half, [0, 9.9]), true);
  assert.equal(insideLoop(half, [0, 10.1]), false);
  assert.equal(insideLoop(half, [0, -1]), false); // below the straight side
  assert.equal(insideLoop(half, [7, 7]), true); // √98 = 9.90 from the centre
  assert.equal(insideLoop(half, [7.1, 7.1]), false); // √100.82 = 10.04
});

test("hand-worked: a square whose top bulges in, a quarter turn", () => {
  // The top runs (20,20) → (0,20), direction −x; the right of that is +y,
  // outward, so a dip into the square is a negative bulge: −tan(π/8), a
  // quarter turn clockwise. Chord 20 over 90°: r = 10/sin 45° = 10√2.
  // Centre = middle (10,20) + perp(−20,0) (1 − β²)/(4β); perp(−20,0) is
  // (0,−20) and (1 − β²)/(4β) = cot(π/4)/2 with the sign of β, −0.5, so
  // the centre is (10, 30). The arc's lowest point is 30 − 10√2 = 15.86.
  const beta = -Math.tan(Math.PI / 8);
  const dipped = path([0, 0, 20, 0, 20, 20, 0, 20], [0, 0, beta, 0]);
  const c = arcCircle([20, 20], [0, 20], beta);
  assert.ok(near(c.centre[0], 10) && near(c.centre[1], 30) && near(c.radius, 10 * Math.SQRT2));
  assert.equal(insideLoop(dipped, [10, 15.5]), true); // under the dip
  assert.equal(insideLoop(dipped, [10, 16.2]), false); // in the dip
  assert.equal(insideLoop(dipped, [2, 19]), false); // √(64 + 121) = 13.6 < 14.14 from the centre: cut away
  assert.equal(insideLoop(dipped, [0.5, 19]), true); // √(90.25 + 121) = 14.53: still in the square
  assert.equal(insideLoop(dipped, [10, 21]), false); // above the square
});

test("hand-worked: a major arc (more than a half turn) round a short chord", () => {
  // (−6,−8) → (6,−8) straight, then (6,−8) → (−6,−8) counter-clockwise
  // round (0,0) through (0,10): from −53.13° up to 233.13°, a 286.26° turn,
  // bulge tan(71.57°) = 3. r = 12 (1 + 9) / 12 = 10; centre (0,−8) +
  // (0,−12)(1 − 9)/12 = (0,0). The chord polygon has no area (a piece and
  // its way back), so the region is the arc's segment alone: the disc on
  // the arc's side of the chord, above y = −8.
  const keyhole = path([-6, -8, 6, -8], [0, 3]);
  const c = arcCircle([6, -8], [-6, -8], 3);
  assert.ok(near(c.centre[0], 0) && near(c.centre[1], 0) && near(c.radius, 10));
  assert.equal(insideLoop(keyhole, [0, 0]), true);
  assert.equal(insideLoop(keyhole, [0, 9.9]), true);
  assert.equal(insideLoop(keyhole, [0, -7.9]), true); // just above the chord
  assert.equal(insideLoop(keyhole, [0, -8.1]), false); // just below it, inside the disc
  assert.equal(insideLoop(keyhole, [-9.9, 0]), true);
  assert.equal(insideLoop(keyhole, [0, 10.1]), false);
});

test("hand-worked: a ring of two circles, and a circle's own edge at 0.9× and 1.1× its radius", () => {
  const ring: Outline = { outer: circle(0, 0, 10), holes: [circle(0, 0, 4)] };
  assert.equal(insideOutline(ring, [5, 0]), true);
  assert.equal(insideOutline(ring, [3, 0]), false);
  assert.equal(insideOutline(ring, [11, 0]), false);
  assert.equal(insideOutline(ring, [0, 0.9 * 10]), true);
  assert.equal(insideOutline(ring, [0, 1.1 * 10]), false);
  assert.equal(insideOutline(ring, [0, 1.1 * 4]), true);
  assert.equal(insideOutline(ring, [0, 0.9 * 4]), false);
});

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

/** The simple model's drawing of a loop: a polygon (x, y, x, y, …) with each arc in 4,000 straight pieces by angle (not by bulge segments). */
function modelPolygon(corners: SketchXY[], bulges: number[]): number[] {
  const poly: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    poly.push(a[0], a[1]);
    if (bulges[i] === 0) continue;
    const { centre, radius } = arcCircle(a, b, bulges[i]);
    const sweep = 4 * Math.atan(bulges[i]);
    const start = Math.atan2(a[1] - centre[1], a[0] - centre[0]);
    for (let k = 1; k < 4000; k++) poly.push(centre[0] + radius * Math.cos(start + (sweep * k) / 4000), centre[1] + radius * Math.sin(start + (sweep * k) / 4000));
  }
  return poly;
}

/**
 * The simple model's answer at p: the plain crossing count over the drawn
 * polygon, and p's distance to it. The polygon is drawn once per loop, not
 * per point, and the distance compared squared (its root taken once), so
 * the 50,000 points take seconds, not minutes; the answers are the same.
 */
function modelInside(poly: number[], p: SketchXY): { inside: boolean; gap: number } {
  let inside = false;
  let gap2 = Infinity;
  // Each piece from the point before (the last point, for the first piece: the closing one).
  let ax = poly[poly.length - 2], ay = poly[poly.length - 1];
  for (let i = 0; i < poly.length; i += 2) {
    const bx = poly[i], by = poly[i + 1];
    if (ay > p[1] !== by > p[1] && p[0] < ax + ((p[1] - ay) * (bx - ax)) / (by - ay)) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const ex = ax + t * dx - p[0], ey = ay + t * dy - p[1];
    gap2 = Math.min(gap2, ex * ex + ey * ey);
    ax = bx;
    ay = by;
  }
  return { inside, gap: Math.sqrt(gap2) };
}

test("seeded: 2,000 loops of lines and arcs (crossing themselves too) agree with the finely drawn polygon at 25 points each", () => {
  const rand = seeded(20261026);
  let checked = 0;
  for (let n = 0; n < 2000; n++) {
    const count = 2 + Math.floor(rand() * 7);
    const corners: SketchXY[] = Array.from({ length: count }, () => [rand() * 40 - 20, rand() * 40 - 20]);
    // About half the pieces arcs, bulges up to ±2.5 (turns up to about 270°).
    const bulges = corners.map(() => (rand() < 0.5 ? 0 : (rand() * 2 - 1) * 2.5));
    const loop = path(corners.flat(), bulges);
    const poly = modelPolygon(corners, bulges);
    for (let k = 0; k < 25; k++) {
      const p: SketchXY = [rand() * 80 - 40, rand() * 80 - 40];
      const model = modelInside(poly, p);
      // The drawn polygon is within r(1 − cos(sweep/8000)) of the arcs (micrometres); points that near the curve could go either way.
      if (model.gap < 1e-3) continue;
      assert.equal(insideLoop(loop, p), model.inside, `loop ${n} (${JSON.stringify(loop)}) at ${p}`);
      checked++;
    }
  }
  assert.ok(checked > 49_000, `only ${checked} points checked`);
});

test("hand-worked: a whole circle is drawn in 100 pieces, a quarter arc in 25, each within FILL_SAG of the curve", () => {
  // A piece spanning φ strays r(1 − cos(φ/2)); FILL_SAG = 5e-4 allows
  // φ = 2 acos(0.9995) = 0.063249 rad, so 2π / 0.063249 = 99.3 → 100
  // pieces and (π/2) / 0.063249 = 24.8 → 25.
  assert.equal(arcPieces(2 * Math.PI), 100);
  assert.equal(arcPieces(Math.PI / 2), 25);
  assert.equal(arcPieces(-Math.PI / 2), 25);
  assert.equal(arcPieces(1e-9), 1); // a nearly straight arc is its chord
  const points = loopPoints(circle(3, 4, 10));
  assert.equal(points.length, 100);
  for (const [x, y] of points) assert.ok(near(Math.hypot(x - 3, y - 4), 10));
  // Between neighbours the chord's middle is 10 cos(π/100) from the centre: 0.0493% short, within 0.05%.
  const [a, b] = points;
  const middle = Math.hypot((a[0] + b[0]) / 2 - 3, (a[1] + b[1]) / 2 - 4);
  assert.ok(10 - middle <= FILL_SAG * 10 && near(middle, 10 * Math.cos(Math.PI / 100)));
});

test("a drawn path keeps its corners in order, each arc's points on its circle and on its side", () => {
  // The half disc: corner (−10,0), corner (10,0), then the arc's 49 inner points (a half turn is 50 pieces) up through (0,10).
  const points = loopPoints(path([-10, 0, 10, 0], [0, 1]));
  assert.equal(points.length, 2 + arcPieces(Math.PI) - 1);
  assert.deepEqual(points.slice(0, 2), [[-10, 0], [10, 0]]);
  for (const [x, y] of points.slice(2)) assert.ok(near(Math.hypot(x, y), 10) && y > 0);
  const top = points[2 + (arcPieces(Math.PI) / 2 - 1)];
  assert.ok(near(top[0], 0) && near(top[1], 10));
  // A straight square is its four corners.
  assert.deepEqual(loopPoints(path([0, 0, 1, 0, 1, 1, 0, 1])), [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

test("hand-worked: dragging the arrow follows the point of its line nearest the pointer's ray", () => {
  // The arrow up the z axis from the origin. A ray from (10, 0, 5) along −x
  // passes the axis at (0, 0, 5): 5 mm.
  assert.ok(near(arrowDistance([10, 0, 5], [-1, 0, 0], [0, 0, 0], [0, 0, 1])!, 5));
  // A ray from (10, 0, 0) along (−1, 0, 1) is (10 − t, 0, t), nearest the
  // axis where 10 − t = 0, at (0, 0, 10): 10 mm (the ray needn't be unit).
  assert.ok(near(arrowDistance([10, 0, 0], [-1, 0, 1], [0, 0, 0], [0, 0, 1])!, 10));
  // Below the base: a ray from (10, 3, −7) along −x passes (0, 3, −7): −7 mm.
  assert.ok(near(arrowDistance([10, 3, -7], [-1, 0, 0], [0, 0, 0], [0, 0, 1])!, -7));
  // An arrow along +x from (5, 5, 0): a ray from (12, 20, 0) along −y passes (12, 5, 0), 7 mm along it.
  assert.ok(near(arrowDistance([12, 20, 0], [0, -1, 0], [5, 5, 0], [1, 0, 0])!, 7));
  // The nearest point of the ray behind the camera (pointing away): nothing.
  assert.equal(arrowDistance([10, 0, 5], [1, 0, 0], [0, 0, 0], [0, 0, 1]), null);
  // Looking straight down the arrow: the pointer says nothing about the distance.
  assert.equal(arrowDistance([0, 0, 50], [0, 0, -1], [0, 0, 0], [0, 0, 1]), null);
});

test("the along-the-arrow limit: a ray at sin² = 0.9 × ALONG_ARROW to the arrow is refused, 1.1 × is followed", () => {
  // A ray from (1, 0, 100) tilted by θ off −z towards −x, sin²θ = f × ALONG_ARROW.
  const ray = (f: number): [number, number, number] => {
    const s = Math.sqrt(f * ALONG_ARROW);
    return [-s, 0, -Math.sqrt(1 - s * s)];
  };
  assert.equal(arrowDistance([1, 0, 100], ray(0.9), [0, 0, 0], [0, 0, 1]), null);
  assert.notEqual(arrowDistance([1, 0, 100], ray(1.1), [0, 0, 0], [0, 0, 1]), null);
});

test("seeded: 2,000 random arrows and rays: the distance found is where the two lines come nearest", () => {
  const rand = seeded(7);
  const unit = (): [number, number, number] => {
    const v = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
    const n = Math.hypot(...v);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  let followed = 0;
  for (let n = 0; n < 2000; n++) {
    const base: [number, number, number] = [rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50];
    const direction = unit();
    const from: [number, number, number] = [rand() * 400 - 200, rand() * 400 - 200, rand() * 400 - 200];
    const ray = unit().map((x) => x * (0.5 + rand() * 3)) as [number, number, number];
    const s = arrowDistance(from, ray, base, direction);
    if (s === null) continue;
    followed++;
    // The model: the gap between the lines is smallest at s: moving s by ±0.01 mm (and taking the ray's own nearest point) never makes it smaller.
    const gapAt = (si: number) => {
      const p = base.map((b, i) => b + si * direction[i]);
      const t = ((p[0] - from[0]) * ray[0] + (p[1] - from[1]) * ray[1] + (p[2] - from[2]) * ray[2]) / (ray[0] ** 2 + ray[1] ** 2 + ray[2] ** 2);
      return Math.hypot(...p.map((x, i) => x - (from[i] + t * ray[i])));
    };
    assert.ok(gapAt(s) <= gapAt(s + 0.01) + 1e-9 && gapAt(s) <= gapAt(s - 0.01) + 1e-9, `case ${n}`);
  }
  assert.ok(followed > 900, `only ${followed} rays pointed at their arrows`);
});

test("hand-worked: a dragged distance snaps to whole mm, never 0, crossing the plane flips the side", () => {
  assert.equal(snapDistance(12.4), 12);
  assert.equal(snapDistance(12.5), 13);
  assert.equal(snapDistance(-12.5), -13); // halves away from 0 both ways
  assert.equal(snapDistance(-12.4), -12);
  assert.equal(snapDistance(0.4), 1);
  assert.equal(snapDistance(-0.4), -1);
  assert.equal(snapDistance(0), 1);
  assert.equal(snapDistance(-0.6), -1);
  assert.equal(snapDistance(250.49), 250);
});

test("hand-worked: the arrow is ARROW_PX long on screen at any zoom", () => {
  // 100 mm away, 45° field of view, 800 px tall: a pixel is 2 × 100 × tan 22.5° / 800 = 0.10355 mm, so 60 px is 6.2132 mm.
  assert.equal(ARROW_PX, 60);
  assert.ok(near(arrowLength(100, 45, 800)!, 6.213203435596426, 1e-12));
  assert.ok(near(arrowLength(1000, 45, 800)!, 62.13203435596426, 1e-11)); // ten times as far: ten times as long
  assert.equal(arrowLength(0, 45, 800), null);
  assert.equal(arrowLength(100, 45, 0), null);
  assert.equal(arrowLength(Number.NaN, 45, 800), null);
});
