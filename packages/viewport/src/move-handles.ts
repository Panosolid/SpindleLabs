// The maths of the Move and Rotate tools' handles in the view (35e2c;
// split into two tools on Ben's ask, 2026-10-29): Move's three arrows along
// X, Y and Z, or Rotate's three grips, each a dot on a short arc of the
// circle turning about one axis, at the point the pivot ends up, the same
// size on screen at any zoom; where each sits this frame so no two press
// areas overlap (`placeHandles`); which one a press is on; and how far a
// drag has gone along an arrow or round a circle. Pure, so every rule is
// unit-tested without a browser; move-layer.ts draws them and viewer.ts
// raycasts.

import type { MoveHandle, MoveKind } from "@fission/core";

type Vec3 = readonly [number, number, number];

/** The handles, in the order they are drawn and offered: the arrows, then the rings. */
export const MOVE_HANDLES: readonly MoveHandle[] = ["x", "y", "z", "turnX", "turnY", "turnZ"];

/** Which axis a handle is along or turns about: 0 X, 1 Y, 2 Z. */
export const handleAxis = (h: MoveHandle): 0 | 1 | 2 => (h === "x" || h === "turnX" ? 0 : h === "y" || h === "turnY" ? 1 : 2);

/** Whether a handle is a ring (it turns) rather than an arrow (it shifts). */
export const isRing = (h: MoveHandle) => h.startsWith("turn");

/** The handles each tool shows. */
export const KIND_HANDLES: Record<MoveKind, readonly MoveHandle[]> = { move: ["x", "y", "z"], rotate: ["turnX", "turnY", "turnZ"] };

/**
 * The sizes on screen (CSS px): each arrow from ARROW_FROM to ARROW_TO
 * along its axis, and each Rotate grip a short arc of the circle of
 * radius `ring` about the centre, `arc` degrees each side of a dot at its
 * middle (Ben, 2026-10-29: Fusion's rings were near impossible to hit, so
 * dots on short arcs, spread apart, in our own slim style).
 */
export const MOVE_PX = { ring: 72, arc: 22.5, arrowFrom: 58, arrowTo: 136 };

/** Straight pieces a grip's arc is drawn and hit-tested as (4.5° each: at 72 px within 0.06 px of the true circle). */
export const ARC_PIECES = 10;

/**
 * How far from a handle's line a press still takes it (CSS px), bigger
 * than Extrude's arrow's (Ben, 2026-10-29: the old rings were near
 * impossible to hit). Handles are placed so no two of these areas ever
 * overlap (`placeHandles`), so a press never lands on two at once.
 */
export const MOVE_GRAB_PX = { mouse: 14, touch: 24 };

/** An arrow shorter on screen than this share of its length points too nearly at the camera to drag along, so it is not shown (0.3: within about 17° of the line of sight). */
export const ARROW_SHOWN = 0.3;

/** A grip whose circle is seen this nearly side-on (|line of sight · axis| below it: within 11.5°) can't be turned by dragging round it, so it is not shown. */
export const RING_SHOWN = 0.2;

/** Where one handle sits this frame: an arrow along its axis (`sign` 1) or the other way (−1), a grip on the arc whose middle is `quarter` · 90° + 45° round its circle (from u towards v, ringBasis). */
export interface Placed {
  handle: MoveHandle;
  sign: 1 | -1;
  quarter: 0 | 1 | 2 | 3;
}

/** The angle (radians) of the middle of a grip on `quarter`: 45°, 135°, 225° or 315° from u towards v. */
export const quarterAngle = (quarter: number): number => ((45 + 90 * quarter) * Math.PI) / 180;

/**
 * The two unit directions a ring about `axis` is measured in, (u, v) with
 * u × v along the axis: about X (Y, Z), about Y (Z, X), about Z (X, Y). So
 * an angle from u towards v is counter-clockwise looking down the axis,
 * as a Move's turns are (move-tool.ts movedPoint).
 */
export function ringBasis(axis: 0 | 1 | 2): [Vec3, Vec3] {
  const e = (k: number): Vec3 => [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
  return [e((axis + 1) % 3), e((axis + 2) % 3)];
}

/**
 * A placed handle as a line of points in model space (mm), `pixel` mm
 * being one CSS pixel at the centre: an arrow its two ends, a grip its arc
 * as ARC_PIECES + 1 points from one end to the other (the dot is the
 * middle one). For drawing and for finding the handle under the pointer
 * once projected to the screen.
 */
export function placedLine(centre: Vec3, pixel: number, p: Placed): Vec3[] {
  const axis = handleAxis(p.handle);
  if (!isRing(p.handle)) {
    const at = (px: number): Vec3 => centre.map((c, k) => (k === axis ? c + p.sign * px * pixel : c)) as unknown as Vec3;
    return [at(MOVE_PX.arrowFrom), at(MOVE_PX.arrowTo)];
  }
  const [u, v] = ringBasis(axis);
  const r = MOVE_PX.ring * pixel;
  const mid = quarterAngle(p.quarter);
  const half = (MOVE_PX.arc * Math.PI) / 180;
  return Array.from({ length: ARC_PIECES + 1 }, (_, i) => {
    const a = mid - half + (2 * half * i) / ARC_PIECES;
    return centre.map((c, k) => c + r * (Math.cos(a) * u[k] + Math.sin(a) * v[k])) as unknown as Vec3;
  });
}

/** The point a press on a placed handle is said to aim at: an arrow's middle, a grip's dot. */
export function gripPoint(line: readonly { x: number; y: number }[], handle: MoveHandle): { x: number; y: number } {
  if (isRing(handle)) return line[ARC_PIECES / 2];
  return { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 };
}

type Xy = { x: number; y: number };

/** The distance from point `p` to the segment from `a` to `b` on screen. */
function pointToSegment(p: Xy, a: Xy, b: Xy): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** The distance between two segments on screen: 0 when they cross, else the least of each end's distance to the other. */
export function segmentGap(a: Xy, b: Xy, c: Xy, d: Xy): number {
  const side = (p: Xy, q: Xy, r: Xy) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const [s1, s2, s3, s4] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
  if (((s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0)) && ((s3 > 0 && s4 < 0) || (s3 < 0 && s4 > 0))) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

/** The least distance between two lines of points on screen. */
export function lineGap(a: readonly Xy[], b: readonly Xy[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) best = Math.min(best, segmentGap(a[i], a[i + 1], b[j], b[j + 1]));
  return best;
}

/**
 * Where each of a tool's handles sits this frame, so no two press areas
 * overlap (their lines on screen at least 2 · MOVE_GRAB_PX.touch apart, a
 * finger's reach either side; a mouse's is less) and each is easy to tell
 * apart. `view` is the line of sight to the centre (any length);
 * `project` takes a model point to the screen (null behind the camera).
 *
 * A handle the camera looks along is left out (an arrow whose part across
 * the line of sight is under ARROW_SHOWN, a grip's circle within RING_SHOWN
 * of side-on: dragging it would say nothing). Of the rest, every way of
 * placing them is tried in order of preference, and the first whose lines
 * keep the gap is taken: arrows along their axes before the other way
 * (flipped only when two would lie on each other), each grip on the arc
 * of its circle nearest the camera first, so the dots spread round the
 * centre on the near side. When no placing keeps the gap, the handle
 * shortest on screen is left out and the rest tried again: so the press
 * areas never overlap, whatever the view.
 */
export function placeHandles(kind: MoveKind, centre: Vec3, pixel: number, view: Vec3, project: (p: Vec3) => Xy | null, reach: number = MOVE_GRAB_PX.touch): Placed[] {
  const length = Math.hypot(view[0], view[1], view[2]);
  if (!(length > 0)) return [];
  const sight = view.map((x) => x / length);
  const onScreen = (points: readonly Vec3[]) => {
    const out = points.map(project);
    return out.every((p): p is Xy => p !== null && Number.isFinite(p.x) && Number.isFinite(p.y)) ? out : null;
  };
  /** Each handle's ways of sitting, most wanted first, and how long it is on screen (0 if it is not shown). */
  const options = KIND_HANDLES[kind].map((handle) => {
    const axis = handleAxis(handle);
    if (!isRing(handle)) {
      // The part of the arrow across the line of sight: what it shows of its length, whichever way it points.
      const across = Math.sqrt(Math.max(0, 1 - sight[axis] * sight[axis]));
      const size = across >= ARROW_SHOWN ? (MOVE_PX.arrowTo - MOVE_PX.arrowFrom) * across : 0;
      return { handle, size, ways: ([1, -1] as const).map((sign): Placed => ({ handle, sign, quarter: 0 })) };
    }
    const facing = Math.abs(sight[axis]);
    const [u, v] = ringBasis(axis);
    // Nearest the camera first: the middle's direction against the line of sight (most negative: towards the camera).
    const towards = (q: number) => {
      const a = quarterAngle(q);
      return [0, 1, 2].reduce((s, k) => s + (Math.cos(a) * u[k] + Math.sin(a) * v[k]) * sight[k], 0);
    };
    const quarters = ([0, 1, 2, 3] as const).slice().sort((a, b) => towards(a) - towards(b) || a - b);
    return { handle, size: facing >= RING_SHOWN ? MOVE_PX.ring * facing : 0, ways: quarters.map((quarter): Placed => ({ handle, sign: 1, quarter })) };
  });
  let shown = options.filter((o) => o.size > 0);
  const gap = 2 * reach;
  for (;;) {
    if (shown.length === 0) return [];
    // Every way of placing the shown handles, in order of preference (the first handle's choice changing slowest).
    const pick = (i: number, chosen: Placed[], lines: Xy[][]): Placed[] | null => {
      if (i === shown.length) return chosen;
      for (const way of shown[i].ways) {
        const line = onScreen(placedLine(centre, pixel, way));
        if (line === null) continue;
        if (lines.some((other) => lineGap(other, line) < gap)) continue;
        const got = pick(i + 1, [...chosen, way], [...lines, line]);
        if (got) return got;
      }
      return null;
    };
    const placed = pick(0, [], []);
    if (placed) return placed;
    const least = shown.reduce((a, b) => (b.size < a.size ? b : a));
    shown = shown.filter((o) => o !== least);
  }
}

/**
 * The handle nearest a point on screen within `radius` px, or null:
 * `lines` are placed handles' lines on screen (x, y per point, NaN for
 * one that cannot be drawn), and a handle's distance is that of its
 * nearest piece. A tie goes to the handle listed first.
 */
export function handleNear(lines: readonly { handle: MoveHandle; screen: readonly { x: number; y: number }[] }[], p: { x: number; y: number }, radius: number): MoveHandle | null {
  let best: { handle: MoveHandle; distance: number } | null = null;
  for (const { handle, screen } of lines) {
    for (let i = 0; i + 1 < screen.length; i++) {
      const [a, b] = [screen[i], screen[i + 1]];
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      const distance = pointToSegment(p, a, b);
      if (distance < radius && (best === null || distance < best.distance)) best = { handle, distance };
    }
  }
  return best?.handle ?? null;
}

/** How nearly side-on to a ring a ray may look before a drag round it stops following (sin of the angle between the ray and the ring's plane: 0.05 is 2.9°). */
export const EDGE_ON = 0.05;

/**
 * Where the ray from `from` along `ray` meets the plane of the ring about
 * `axis` through `centre`, as an angle (radians, from u towards v,
 * ringBasis) about the centre; null when the ray runs within EDGE_ON of
 * the plane (side-on, the pointer says nothing about the angle), meets it
 * behind the camera, or meets it at the centre itself.
 */
export function ringAngle(from: Vec3, ray: Vec3, centre: Vec3, axis: 0 | 1 | 2): number | null {
  const length = Math.hypot(ray[0], ray[1], ray[2]);
  if (!(length > 0) || !(Math.abs(ray[axis]) > EDGE_ON * length)) return null;
  const t = (centre[axis] - from[axis]) / ray[axis];
  if (!(t > 0)) return null;
  const q = [0, 1, 2].map((k) => from[k] + t * ray[k] - centre[k]);
  const [u, v] = ringBasis(axis);
  const [x, y] = [q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * v[0] + q[1] * v[1] + q[2] * v[2]];
  return x === 0 && y === 0 ? null : Math.atan2(y, x);
}

/**
 * The turn from angle `before` to angle `after` (radians) the short way
 * round, in (−π, π]: a drag hears the pointer often, so between two of its
 * moves the ring never turns half way round, and the turns add up past a
 * whole turn without jumping where atan2 wraps.
 */
export function turnBetween(before: number, after: number): number {
  const d = (after - before) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
}
