// The maths of the Move tool's handles in the view (35e2c, Fusion's Move
// gizmo): three arrows along X, Y and Z and three rings turning about them,
// all at the point the pivot ends up, the same size on screen at any zoom;
// which one a press is on; and how far a drag has gone along an arrow or
// round a ring. Pure, so every rule is unit-tested without a browser;
// move-layer.ts draws them and viewer.ts raycasts.

import type { MoveHandle } from "@fission/core";

type Vec3 = readonly [number, number, number];

/** The handles, in the order they are drawn and offered: the arrows, then the rings. */
export const MOVE_HANDLES: readonly MoveHandle[] = ["x", "y", "z", "turnX", "turnY", "turnZ"];

/** Which axis a handle is along or turns about: 0 X, 1 Y, 2 Z. */
export const handleAxis = (h: MoveHandle): 0 | 1 | 2 => (h === "x" || h === "turnX" ? 0 : h === "y" || h === "turnY" ? 1 : 2);

/** Whether a handle is a ring (it turns) rather than an arrow (it shifts). */
export const isRing = (h: MoveHandle) => h.startsWith("turn");

/**
 * The sizes on screen (CSS px): each ring's radius, and each arrow from
 * ARROW_FROM to ARROW_TO along its axis, starting outside the rings so a
 * press never lands on an arrow and a ring at once (save where two rings
 * cross on an axis, which the nearer takes).
 */
export const MOVE_PX = { ring: 45, arrowFrom: 58, arrowTo: 110 };

/** Straight pieces a ring is drawn and hit-tested as (7.5° each, at 45 px within 0.4 px of the true circle). */
export const RING_PIECES = 48;

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
 * Each handle as a line of points in model space (mm), `pixel` mm being
 * one CSS pixel at the centre: an arrow its two ends, a ring RING_PIECES +
 * 1 points round it (the first again at the end). For drawing and for
 * finding the handle under the pointer once projected to the screen.
 */
export function handleLines(centre: Vec3, pixel: number): { handle: MoveHandle; points: Vec3[] }[] {
  return MOVE_HANDLES.map((handle) => {
    const axis = handleAxis(handle);
    if (!isRing(handle)) {
      const at = (px: number): Vec3 => centre.map((c, k) => (k === axis ? c + px * pixel : c)) as unknown as Vec3;
      return { handle, points: [at(MOVE_PX.arrowFrom), at(MOVE_PX.arrowTo)] };
    }
    const [u, v] = ringBasis(axis);
    const r = MOVE_PX.ring * pixel;
    const points = Array.from({ length: RING_PIECES + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / RING_PIECES;
      return centre.map((c, k) => c + r * (Math.cos(a) * u[k] + Math.sin(a) * v[k])) as unknown as Vec3;
    });
    return { handle, points };
  });
}

/**
 * The handle nearest a point on screen within `radius` px, or null:
 * `lines` are handleLines' lines on screen (x, y per point, NaN for one
 * that cannot be drawn), and a handle's distance is that of its nearest
 * piece. A tie goes to the handle listed first.
 */
export function handleNear(lines: readonly { handle: MoveHandle; screen: readonly { x: number; y: number }[] }[], p: { x: number; y: number }, radius: number): MoveHandle | null {
  let best: { handle: MoveHandle; distance: number } | null = null;
  for (const { handle, screen } of lines) {
    for (let i = 0; i + 1 < screen.length; i++) {
      const [a, b] = [screen[i], screen[i + 1]];
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      const distance = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
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
