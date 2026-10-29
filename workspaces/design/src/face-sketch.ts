// Sketches on a body's flat face (step 26c; the owner's answers Q1 to Q6,
// docs/progress/cad.md, "Sketch on a face test plan (26a)"). The rules are
// the naming model's (packages/testing/src/naming-model.ts, rules 1, 2, 6,
// 7 and 8), the oracle Design is checked against on the real kernel
// (packages/testing/journeys/naming.journey.ts):
//
// - The sketch item names its face as a reference does
//   ("face:feature-2/end", "face:feature-2/side:line-4"; references.ts);
//   its content keeps the frame it was drawn with and its side, and holds
//   a placement (`held`) only while that name finds no face or two.
// - Its coordinates are the world's (Q2): the frame is the origin plane
//   (XY, then XZ, then YZ on a tie) most nearly parallel to the face when
//   drawn, turned onto the face the shortest way, its origin where the
//   world's origin meets the face's plane square on. On a back or bottom
//   face the frame's normal points into the body and the sketch faces
//   against it (side −1), so its x and y still read as the world's.
// - On every rebuild the frame turns with the face the shortest way from
//   the frame as drawn (never from the last one: two shortest turns are
//   not one), keeping the side of the face its normal was on.
// - From 35e2h it is first carried by what the Moves before it did to the
//   face's body since it was drawn (`body`: where they had put the body's
//   own frame, the world's, when drawn; `bodyFrame` now), so a Move edited
//   to slide the face along itself, or turn it about its normal, takes the
//   sketch with it, as it takes the face.
//
// Every frame is worked out in doubles and squared up (unit axes, x square
// to the normal) before the kernel sees it: the kernel refuses a frame off
// by more than 64 ulps (the kernel's FRAME_SQUARE).

import type { BodySpec, BodyView, Feature, GeometryReference, Motion, Plane, StableId } from "@fission/core";
import { readDesignReference } from "./references.ts";

type Vec3 = [number, number, number];

/** Where a sketch lies: its frame, and which way it faces against the frame's normal (+1 along it, −1 against). */
export interface SketchPlacement {
  plane: Plane;
  side: 1 | -1;
  /** Where the Moves before it had put the face's body's own frame when picked (`bodyFrame`); none when not moved. */
  body?: Plane;
}

/** Why a face sketch is held at its last placement: its face's name finds no face, or two. */
export type PlaneCause = "plane-lost" | "plane-ambiguous";

/** A face sketch's plane warning: the cause, the face's name (the sketch item's `plane`), and words for the app. */
export interface PlaneWarning {
  cause: PlaneCause;
  face: string;
  message: string;
}

/**
 * Where a sketch on a face was drawn, kept with its content (document.ts
 * `Sketch.face`; its timeline item's `plane` names the face): the frame as
 * drawn, its side, and the placement it holds while the face is lost.
 */
export interface SketchFace {
  frame: Plane;
  side: 1 | -1;
  held?: Plane;
  /** Where the Moves before it had put the face's body's own frame (the world's) when drawn; none when it was not moved (35e2h). */
  body?: Plane;
}

/** The origin planes in the order a tie is broken (sketch.ts PLANES; the model's ORIGIN_FRAMES). */
const ORIGIN_FRAMES: readonly { x: Vec3; normal: Vec3 }[] = [
  { x: [1, 0, 0], normal: [0, 0, 1] },
  { x: [1, 0, 0], normal: [0, -1, 0] },
  { x: [0, 1, 0], normal: [1, 0, 0] },
];

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// `+ 0` turns −0 into 0, so a frame written to a file reads back equal.
const scale = (a: readonly number[], k: number): Vec3 => [a[0] * k + 0, a[1] * k + 0, a[2] * k + 0];
const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: readonly number[]): Vec3 => scale(a, 1 / Math.sqrt(dot(a, a)));
const sign = (x: number): 1 | -1 => (x < 0 ? -1 : 1);

/**
 * `v` turned by the shortest rotation taking unit `from` to unit `to`
 * (Rodrigues without the angle: with c = from · to and w = from × to,
 * R v = c v + w × v + (w · v) w / (1 + c)); only used with c ≥ 0, so
 * 1 + c ≥ 1 and nothing is divided by a small number.
 */
export function turned(v: readonly number[], from: readonly number[], to: readonly number[]): Vec3 {
  const c = dot(from, to);
  const w = cross(from, to);
  return add(add(scale(v, c), cross(w, v)), scale(w, dot(w, v) / (1 + c)));
}

/**
 * How far squaring a frame already square moves its unit axes, at most, in
 * each part: its rounding, a few ulps of 1 (well inside the kernel's
 * FRAME_SQUARE, 64 ulps). Not a tolerance on geometry: only what tells a
 * frame squared before from one that isn't.
 */
const SQUARING_ROUNDING = 8 * Number.EPSILON;

/** At most this many squarings after the first: each takes an x nearly along the normal closer to square. */
const SQUARING_PASSES = 8;

/** One squaring: the normal made unit, x made square to it (its part along the normal taken off) and unit; null when it can't be. */
function squaredOnce(p: Plane): Plane | null {
  const nn = dot(p.normal, p.normal);
  if (!(nn > 0) || !Number.isFinite(nn)) return null;
  const n = unit(p.normal);
  const x = add(p.xAxis, scale(n, -dot(p.xAxis, n)));
  const xx = dot(x, x);
  if (!(xx > 0) || !Number.isFinite(xx)) return null;
  return { origin: [p.origin[0] + 0, p.origin[1] + 0, p.origin[2] + 0], xAxis: unit(x), normal: n };
}

/** Whether frame `q`'s axes are within a squaring's rounding of `p`'s, part by part. */
const roundingApart = (p: Plane, q: Plane): boolean =>
  [0, 1, 2].every((k) => Math.abs(p.xAxis[k] - q.xAxis[k]) <= SQUARING_ROUNDING && Math.abs(p.normal[k] - q.normal[k]) <= SQUARING_ROUNDING);

/**
 * The frame squared up in doubles: the normal made unit, x made square to
 * it (its part along the normal taken off) and unit. Null when the normal
 * is nothing or x lies along it, so no frame can be made (a hand-edited
 * file); anything else comes out within a few ulps of unit and square.
 * A frame square already (to a squaring's rounding) comes back with its
 * very axes, and any other is squared until it is, so squaring twice gives
 * what squaring once did: squared in doubles again, a frame can move an
 * ulp each time (four frames in ten from slanted faces do), and a sketch
 * held at a squared frame was drawn an ulp from where it was (face-chaos
 * seed 61, 27c). An x nearly along the normal takes a few squarings, each
 * leaving it less off square.
 */
export function squared(p: Plane): Plane | null {
  const q = squaredOnce(p);
  if (q === null) return null;
  if (roundingApart(p, q)) return { origin: q.origin, xAxis: [p.xAxis[0], p.xAxis[1], p.xAxis[2]], normal: [p.normal[0], p.normal[1], p.normal[2]] };
  // Each squaring leaves the last a little less off square; one that moves nothing past its rounding is square.
  let now = q;
  for (let pass = 0; pass < SQUARING_PASSES; pass++) {
    const again = squaredOnce(now)!;
    if (roundingApart(now, again)) return now;
    now = again;
  }
  return now;
}

/**
 * The frame a sketch drawn on a flat face gets (rule 8), from the face's
 * outward unit normal and a point of its plane (the kernel's face_normals
 * and face_centroids): the origin plane whose normal is most nearly along
 * the face's (the largest |outward · normal|; a tie goes to the first of
 * XY, XZ, YZ), its normal turned onto the face the shortest way on the
 * origin plane's side; its origin the plane's nearest point to the
 * world's origin. `side` is +1 when the face looks along that normal.
 */
export function drawnFrame(outward: readonly number[], point: readonly number[]): SketchPlacement {
  let best = ORIGIN_FRAMES[0];
  for (const f of ORIGIN_FRAMES) if (Math.abs(dot(outward, f.normal)) > Math.abs(dot(outward, best.normal))) best = f;
  const side = sign(dot(outward, best.normal));
  const normal = scale(unit(outward), side);
  const plane = squared({ origin: scale(normal, dot(point, normal)), xAxis: turned(best.x, best.normal, normal), normal })!;
  return { plane, side };
}

/**
 * The frame a sketch drawn on face `face` of a built body gets
 * (`drawnFrame` on the kernel's exact face_normals and face_centroids);
 * null for a curved face, which can't be sketched on (Q5).
 */
export function drawnOnFace(view: BodyView, face: number): SketchPlacement | null {
  const outward = view.face_normals[face];
  return outward ? drawnFrame(outward, view.face_centroids[face]) : null;
}

/** The world's own frame: where a body that no Move has moved keeps its own. */
const WORLD: Plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };

/**
 * `v` turned `angle` radians counter-clockwise looking down unit `k` (the
 * right-hand rule, as the kernel's `turn`), by Rodrigues' formula:
 * R v = v cos a + (k × v) sin a + k (k · v)(1 − cos a).
 */
function spun(v: readonly number[], k: readonly number[], angle: number): Vec3 {
  const c = Math.cos(angle);
  return add(add(scale(v, c), scale(cross(k, v), Math.sin(angle))), scale(k, dot(k, v) * (1 - c)));
}

/**
 * Where a body's moves (its spec's, in order: kernel-types.ts `Motion`) put
 * the body's own frame, the world's: its origin shifted and turned about
 * each pivot line, its axes turned. Null when nothing moved it (no moves,
 * or a spec that is not moved), so a sketch on a body never moved keeps no
 * `body` and is placed exactly as before 35e2h.
 */
export function bodyFrame(spec: BodySpec): Plane | null {
  const moves: readonly Motion[] = "moved" in spec ? spec.moved.moves : [];
  if (moves.length === 0) return null;
  let o: Vec3 = [0, 0, 0];
  let x: Vec3 = [1, 0, 0];
  let n: Vec3 = [0, 0, 1];
  for (const m of moves) {
    if ("move" in m) {
      o = add(o, m.move);
      continue;
    }
    const k = unit(m.turn.axis);
    const p = m.turn.pivot;
    o = add(spun([o[0] - p[0], o[1] - p[1], o[2] - p[2]], k, m.turn.angle), p);
    x = spun(x, k, m.turn.angle);
    n = spun(n, k, m.turn.angle);
  }
  return squared({ origin: o, xAxis: x, normal: n });
}

/** Whether two frames are the same, part by part. */
const sameFrame = (a: Plane, b: Plane): boolean => [0, 1, 2].every((k) => a.origin[k] === b.origin[k] && a.xAxis[k] === b.xAxis[k] && a.normal[k] === b.normal[k]);

/**
 * The rigid motion taking frame `from` onto frame `to` (each the world's
 * when not given), as a map of points (or, with `vector`, directions): a
 * point's parts along `from`'s x, y = normal × x and normal, laid along
 * `to`'s. Null when the two are the same frame, so nothing is worked out
 * (not even a rounding) for a body that has not moved since.
 */
export function carried(from: Plane | undefined, to: Plane | undefined): ((p: readonly number[], vector: boolean) => Vec3) | null {
  const a = from ?? WORLD;
  const b = to ?? WORLD;
  if (sameFrame(a, b)) return null;
  const ay = cross(a.normal, a.xAxis);
  const by = cross(b.normal, b.xAxis);
  return (p, vector) => {
    const d = vector ? [p[0], p[1], p[2]] : [p[0] - a.origin[0], p[1] - a.origin[1], p[2] - a.origin[2]];
    const v = add(add(scale(b.xAxis, dot(d, a.xAxis)), scale(by, dot(d, ay))), scale(b.normal, dot(d, a.normal)));
    return vector ? v : add(v, b.origin);
  };
}

/**
 * Where the frame drawn as `drawn` lies now that its face's outward unit
 * normal is `outward` and `point` is on its plane (rule 8): the normal is
 * ±outward, on the side the drawn normal was (exactly square, the outward
 * one), x turned the shortest way from the drawn frame's, and the origin
 * the plane's nearest point to the world's origin. With `carry` (35e2h:
 * the motion of the face's body since drawn, `carried`), the drawn frame
 * and the world's origin are carried by it first, so the sketch slides and
 * turns with its face; the face's plane still has the last word.
 */
export function frameNow(drawn: Plane, outward: readonly number[], point: readonly number[], carry: ReturnType<typeof carried> = null): Plane {
  if (carry !== null) return carriedNow(drawn, outward, point, carry);
  const n = scale(unit(outward), sign(dot(drawn.normal, outward)));
  return squared({ origin: scale(n, dot(point, n)), xAxis: turned(drawn.xAxis, drawn.normal, n), normal: n })!;
}

/** `frameNow` with a carry: the drawn axes and the world's origin carried first, the origin then put on the face's plane square on. */
function carriedNow(drawn: Plane, outward: readonly number[], point: readonly number[], carry: NonNullable<ReturnType<typeof carried>>): Plane {
  const x = carry(drawn.xAxis, true);
  const along = carry(drawn.normal, true);
  const n = scale(unit(outward), sign(dot(along, outward)));
  const o = carry([0, 0, 0], false);
  return squared({ origin: add(o, scale(n, dot(point, n) - dot(o, n))), xAxis: turned(x, along, n), normal: n })!;
}

/** Whether a sketch item's plane is a face's name, not an origin plane. */
export const isFacePlane = (plane: unknown): plane is string => typeof plane === "string" && plane.startsWith("face:");

/** Whether a timeline item is a sketch on a face. */
export const isFaceSketch = (f: Feature): boolean => f.intent.type === "sketch" && isFacePlane(f.intent.parameters.plane);

/** The reference a face sketch's plane names its face with. */
export const faceReference = (plane: string): GeometryReference => ({ kind: "face", id: plane as StableId });

/**
 * The id of the feature whose face a face sketch's plane names (names
 * escape ids with encodeURIComponent, naming.ts), or null when the plane
 * is not a face reference Design makes.
 */
export function faceFeature(plane: string): string | null {
  const r = readDesignReference(faceReference(plane));
  if (r === null || r.kind !== "face") return null;
  try {
    return decodeURIComponent(r.featureId);
  } catch {
    return null;
  }
}

/** The plane of a face as a sketch's `plane` names it: "face:" + the feature's escaped id + "/" + the face's part ("end", "side:line-4"). */
export const facePlane = (escapedFeature: string, part: string): string => `face:${escapedFeature}/${part}`;

/** The kernel's frame for a plane: its origin, x axis and normal. */
export const frameOf = (p: Plane): { origin: Vec3; x: Vec3; normal: Vec3 } => ({ origin: [...p.origin], x: [...p.xAxis], normal: [...p.normal] });

/** The words for a face sketch's plane warning, naming the sketch and the face it held. */
export function planeWords(cause: PlaneCause, sketchLabel: string): string {
  return cause === "plane-lost"
    ? `${sketchLabel}'s face is gone, so its plane is lost: it stays where it was`
    : `${sketchLabel}'s face is now more than one face, so its plane is ambiguous: it stays where it was rather than guess`;
}
