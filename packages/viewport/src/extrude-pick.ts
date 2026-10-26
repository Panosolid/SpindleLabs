// The maths of Extrude in the view (UX1b, Fusion's feel): which closed
// sketch outline is under the pointer, the outline sampled for drawing as a
// see-through fill, and where dragging the distance arrow puts the
// distance. Pure, so every rule is unit-tested without a browser;
// viewer.ts draws and raycasts.

import type { Loop, Outline, SketchXY } from "@fission/core";

type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One piece of a path loop: from corner a to corner b, straight (bulge 0) or an arc (the kernel's bulge, tan of a quarter of its turn, positive counter-clockwise). */
interface Piece {
  a: SketchXY;
  b: SketchXY;
  bulge: number;
}

function piecesOf(path: { corners: number[]; bulges: number[] }): Piece[] {
  const n = path.corners.length / 2;
  const at = (i: number): SketchXY => [path.corners[2 * (i % n)], path.corners[2 * (i % n) + 1]];
  return Array.from({ length: n }, (_, i) => ({ a: at(i), b: at(i + 1), bulge: path.bulges[i] ?? 0 }));
}

/**
 * The circle an arc piece lies on (kernel/src/ops/profile.rs Seg::from_bulge):
 * chord c = |b − a|, radius c(1 + β²) / (4|β|), centre the chord's middle
 * plus perp(b − a) (1 − β²) / (4β), perp(x, y) = (−y, x).
 */
export function arcCircle(a: SketchXY, b: SketchXY, bulge: number): { centre: SketchXY; radius: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  const k = (1 - bulge * bulge) / (4 * bulge);
  return { centre: [(a[0] + b[0]) / 2 - dy * k, (a[1] + b[1]) / 2 + dx * k], radius: (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge)) };
}

/**
 * Whether `p` is inside one loop. A circle: nearer its centre than its
 * radius. A path: the even-odd rule, exact for arcs, done in two parts.
 * The loop is its polygon of chords plus, for each arc, the closed curve
 * arc-then-chord-back; insideness mod 2 adds over closed curves, so p is in
 * the loop when it is in the chord polygon XOR in an odd number of the
 * arcs' segments (each segment the region between an arc and its chord:
 * nearer the arc's centre than its radius, and on the arc's side of the
 * chord, the right of a → b for a positive bulge, the left for a negative
 * one). An arc bulging out adds its segment, one bulging in takes it away,
 * with no case of its own. The chord polygon is the usual crossing count of
 * a ray from p towards +x, each edge counted when its ends lie either side
 * of p's row (one end strictly above, the other not), so a corner on the
 * row is counted once. A point exactly on the boundary may go either way.
 */
export function insideLoop(loop: Loop, p: SketchXY): boolean {
  if ("circle" in loop) return Math.hypot(p[0] - loop.circle.center[0], p[1] - loop.circle.center[1]) < loop.circle.radius;
  let inside = false;
  for (const { a, b, bulge } of piecesOf(loop.path)) {
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
    if (bulge === 0) continue;
    const { centre, radius } = arcCircle(a, b, bulge);
    const side = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); // > 0: left of a → b
    if (Math.hypot(p[0] - centre[0], p[1] - centre[1]) < radius && side * bulge < 0) inside = !inside;
  }
  return inside;
}

/** Whether `p` (in the sketch plane's frame) is in the region an outline bounds: inside its outer loop and in none of its holes. */
export function insideOutline(outline: Outline, p: SketchXY): boolean {
  return insideLoop(outline.outer, p) && !outline.holes.some((h) => insideLoop(h, p));
}

/** The most an arc drawn as straight pieces strays from the true arc, as a share of its radius (1/2000: 0.005 mm on a 10 mm circle). */
export const FILL_SAG = 5e-4;
/**
 * How many straight pieces draw an arc turning through `sweep` radians so
 * that none strays more than FILL_SAG × radius from it: a chord spanning
 * angle φ strays r(1 − cos(φ/2)), so φ ≤ 2 acos(1 − FILL_SAG), and the
 * count is |sweep| over that, rounded up (100 for a whole circle), and at
 * least 1.
 */
export function arcPieces(sweep: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweep) / (2 * Math.acos(1 - FILL_SAG))));
}

/** A loop as the points of a polygon (no point repeated at the end), arcs drawn in `arcPieces` straight pieces, for drawing it filled. */
export function loopPoints(loop: Loop): SketchXY[] {
  if ("circle" in loop) {
    const { center, radius } = loop.circle;
    const n = arcPieces(2 * Math.PI);
    return Array.from({ length: n }, (_, k) => [center[0] + radius * Math.cos((2 * Math.PI * k) / n), center[1] + radius * Math.sin((2 * Math.PI * k) / n)] as const);
  }
  const points: SketchXY[] = [];
  for (const { a, b, bulge } of piecesOf(loop.path)) {
    points.push(a);
    if (bulge === 0) continue;
    const { centre, radius } = arcCircle(a, b, bulge);
    const sweep = 4 * Math.atan(bulge);
    const start = Math.atan2(a[1] - centre[1], a[0] - centre[0]);
    const n = arcPieces(sweep);
    for (let k = 1; k < n; k++) points.push([centre[0] + radius * Math.cos(start + (sweep * k) / n), centre[1] + radius * Math.sin(start + (sweep * k) / n)]);
  }
  return points;
}

/**
 * Where dragging the distance arrow puts the distance: the arrow lies on
 * the line base + s·direction (direction a unit vector, s the signed
 * distance), the pointer is the camera's ray from + t·ray, and the drag
 * follows the point of the arrow's line nearest the ray. With w = base −
 * from, b = direction·ray, c = ray·ray, d = direction·w, e = ray·w, the two
 * nearest points have s = (b e − c d) / (c − b²) (the usual closest points
 * of two lines, with direction·direction = 1). Null when the ray runs along
 * the arrow (c − b² below ALONG_ARROW × c: looking down the arrow, the
 * pointer says nothing about how far it goes), or the nearest point on the
 * ray is behind the camera.
 */
export function arrowDistance(from: Vec3, ray: Vec3, base: Vec3, direction: Vec3): number | null {
  const w: Vec3 = [base[0] - from[0], base[1] - from[1], base[2] - from[2]];
  const b = dot(direction, ray), c = dot(ray, ray), d = dot(direction, w), e = dot(ray, w);
  const denominator = c - b * b;
  if (!(denominator > ALONG_ARROW * c)) return null;
  const s = (b * e - c * d) / denominator;
  const t = (e - b * d) / denominator; // where on the ray: (e − b d) / (c − b²)
  return t > 0 && Number.isFinite(s) ? s : null;
}

/** How nearly along the arrow a ray may run before a drag stops following it: sin² of the angle between them (1e-4 is 0.57°). */
export const ALONG_ARROW = 1e-4;

/**
 * A dragged distance snapped to whole millimetres, as Fusion's arrow
 * moves in steps: rounded to the nearest whole mm (halves away from 0,
 * as Math.round does not do below zero), never 0, which builds nothing:
 * below half a millimetre it is 1 mm on the side the drag is on (−1 below
 * the plane), so crossing the plane flips the side.
 */
export function snapDistance(s: number): number {
  const whole = Math.sign(s) * Math.round(Math.abs(s));
  return whole === 0 ? (s < 0 ? -1 : 1) : whole;
}

/** How long the arrow is drawn on screen (CSS px), whatever the zoom, and how near (px) a press must be to grab it; a touch gets more room. */
export const ARROW_PX = 60;
export const ARROW_GRAB_PX = { mouse: 10, touch: 22 };

/**
 * The arrow's length in model mm for a view: ARROW_PX on screen at
 * `distance` mm from a camera with vertical field of view `fov` (degrees)
 * on a view `height` px tall, a pixel there being 2 distance tan(fov/2) /
 * height mm. Null when any of them is not a positive finite number.
 */
export function arrowLength(distance: number, fov: number, height: number): number | null {
  const mm = (ARROW_PX * 2 * distance * Math.tan((fov * Math.PI) / 360)) / height;
  return distance > 0 && height > 0 && mm > 0 && Number.isFinite(mm) ? mm : null;
}
