// Move's snap (step 35e2d): a face or edge of a body being moved, picked
// as the "from", lands on a face or edge of another body, the "to", the
// way Tinkercad drops a part onto a face: a flat face lands on a flat face
// facing it (outward normals opposite, touching), centre on centre; a
// straight edge on a straight edge (along the same line, middle on
// middle); a round edge on a round edge (centre on centre, the flat faces
// beside them facing each other, as a lid sits on a can); a round side (a
// cylinder's, or an arc's side of an extrude) on a round side, along one
// axis, middle on middle, as a shaft goes into a hole (35e2k); a sphere on
// a sphere, centre on centre, its turn kept. The bodies are
// turned by the smallest turn that does it on top of the turn the boxes
// already hold, so a part already stood on its side stays as it is about
// the snapped direction. The answer is the Move's numbers, which the panel
// shows in its boxes as if typed: OK records them like any other.

import type { BodyView } from "@fission/core";
import { isMoveItem, type DesignDocument } from "./document.ts";
import { moveValues, type MoveValues } from "./move.ts";
import { movedPoint, unmovedPoint, type PointMap } from "./move-tool.ts";

type Point = [number, number, number];
type Matrix = [Point, Point, Point];

/**
 * What a picked face or edge snaps by: a flat face's centroid and outward
 * normal, a straight edge's middle and direction, a round edge's centre and
 * the outward normal of the flat face beside it, a round side's axis (the
 * middle of its round edges' centres and the direction through them), a
 * sphere's centre. Directions are unit.
 */
export type SnapPart =
  | { kind: "face"; point: Point; normal: Point }
  | { kind: "line"; point: Point; direction: Point }
  | { kind: "circle"; point: Point; normal: Point }
  | { kind: "axis"; point: Point; direction: Point }
  | { kind: "centre"; point: Point };

/** What each kind of part is called in the words the panel says. */
const PART_WORDS: Record<SnapPart["kind"], string> = { face: "a flat face", line: "a straight edge", circle: "a round edge", axis: "a round side", centre: "a sphere" };

/** A curved face with nothing to snap by: a kind the kernel may make one day, a round side without two round edges round its axis, a sphere without its equator. */
export const SNAP_CURVED_FACE = "This curved face has no round edges to find its axis or centre by: pick a flat face, or an edge.";
/** A round edge with no flat face beside it: nothing says which way it faces. */
export const SNAP_NO_FLAT = "This round edge has no flat face beside it, so it can't be snapped: pick another face or edge.";

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: readonly number[]): Point => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Face or edge `index` (the kernel's, on its own body) of `view` as a snap part, or why it can't be snapped. */
export function snapPart(view: BodyView, kind: "face" | "edge", index: number): { part: SnapPart } | { refused: string } {
  if (kind === "face") {
    const normal = view.face_normals[index];
    const point = view.face_centroids[index];
    if (view.face_types[index] === "cylinder") return roundSide(view, index);
    if (view.face_types[index] === "sphere") return sphereCentre(view, index);
    if (view.face_types[index] !== "plane" || !normal || !point) return { refused: SNAP_CURVED_FACE };
    return { part: { kind: "face", point: [...point], normal: unit(normal) } };
  }
  if (view.edge_types[index] === "circle") {
    const centre = view.edge_centres[index];
    const flat = (view.edge_faces[index] ?? []).map((f) => view.face_normals[f]).find((n) => n);
    if (!centre || !flat) return { refused: SNAP_NO_FLAT };
    return { part: { kind: "circle", point: [...centre], normal: unit(flat) } };
  }
  const [s, e] = view.edge_vertices[index].map((k) => view.vertex_points[k]);
  return { part: { kind: "line", point: [...view.edge_middles[index]], direction: unit([e[0] - s[0], e[1] - s[1], e[2] - s[2]]) } };
}

/** The round (circle or arc) edges of face `index`: the kernel's edge indices whose two faces include it. */
const roundEdges = (view: BodyView, index: number) => view.edge_types.flatMap((t, e) => (t === "circle" && view.edge_centres[e] && view.edge_faces[e]?.includes(index) ? [e] : []));

/**
 * A round side's axis (35e2k): every round edge of a cylinder face is a
 * circle or arc square to its axis, centred on it, so the line through two
 * of their centres is the axis, exact (the face's centroid is off it for an
 * arc's side, and only near it in floating point for a whole cylinder's).
 * The two farthest apart are taken (a cylinder's two rims, an arc side's
 * top and bottom arcs), the point is halfway between them: the side's
 * middle along its axis. Fewer than two centres apart: refused.
 */
function roundSide(view: BodyView, index: number): { part: SnapPart } | { refused: string } {
  const centres = roundEdges(view, index).map((e) => view.edge_centres[e]!);
  let best: [Point, Point] | null = null;
  let far = 0;
  for (let i = 0; i < centres.length; i++)
    for (let j = i + 1; j < centres.length; j++) {
      const d = Math.hypot(centres[j][0] - centres[i][0], centres[j][1] - centres[i][1], centres[j][2] - centres[i][2]);
      if (d > far) [far, best] = [d, [centres[i], centres[j]]];
    }
  if (best === null) return { refused: SNAP_CURVED_FACE };
  const [a, b] = best;
  return { part: { kind: "axis", point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], direction: unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) } };
}

/**
 * A sphere's centre (35e2k): the kernel's sphere is two halves joined at
 * its equator, a great circle, whose centre is the sphere's. Only a round
 * edge with a sphere face on both sides is taken as that equator (a round
 * edge between a sphere and a flat cut would be a smaller circle, centred
 * off the sphere's centre); none: refused.
 */
function sphereCentre(view: BodyView, index: number): { part: SnapPart } | { refused: string } {
  const equator = roundEdges(view, index).find((e) => view.edge_faces[e]!.every((f) => view.face_types[f] === "sphere"));
  if (equator === undefined) return { refused: SNAP_CURVED_FACE };
  return { part: { kind: "centre", point: [...view.edge_centres[equator]!] } };
}

/** `part` taken through `map`: its point moved, its direction turned. */
export function mappedPart(part: SnapPart, map: PointMap): SnapPart {
  const point = map(part.point, false);
  if (part.kind === "centre") return { kind: "centre", point };
  return part.kind === "line" || part.kind === "axis" ? { kind: part.kind, point, direction: unit(map(part.direction, true)) } : { kind: part.kind, point, normal: unit(map(part.normal, true)) };
}

/**
 * Below this, two unit directions count as lying along one line (the sine
 * of the angle between them): the turn between them is none, or half a
 * turn about a fixed axis. It keeps the boxes clean (exactly 0° or 180°)
 * when the kernel's normals of square faces differ by rounding, and costs
 * at most 1e-12 × the size, 1e-6 mm at model space's 1 km edge.
 */
export const PARALLEL = 1e-12;

/** The rotation matrix of `angle` radians about unit axis `k`, counter-clockwise looking down it (Rodrigues). */
function about(k: Point, angle: number): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = k;
  return [
    [c + t * x * x, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, c + t * y * y, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, c + t * z * z],
  ];
}

/**
 * The smallest turn taking unit direction `u` to unit direction `w`: about
 * u × w by the angle between them. Along one line (within PARALLEL) it is
 * no turn, or for opposite directions half a turn about the world axis
 * most square to `u` (X, then Y, then Z on a tie) made square to it, so a
 * face turned to face the other way flips about X or Y as a hand would.
 */
export function turnBetween(u: Point, w: Point): Matrix {
  const k = cross(u, w);
  const s = Math.hypot(k[0], k[1], k[2]);
  const c = dot(u, w);
  if (s >= PARALLEL) return about(unit(k), Math.atan2(s, c));
  if (c > 0) return about([1, 0, 0], 0);
  const axes: Point[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const e = axes.reduce((best, a) => (Math.abs(dot(a, u)) < Math.abs(dot(best, u)) ? a : best));
  const d = dot(e, u);
  return about(unit([e[0] - d * u[0], e[1] - d * u[1], e[2] - d * u[2]]), Math.PI);
}

const times = (a: Matrix, b: Matrix): Matrix => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as Matrix;

/** The turn a Move of `v` gives as a matrix: column k is axis k turned (movedPoint, so the order X, Y, Z is the Move's own). */
export function turnMatrix(v: MoveValues): Matrix {
  const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Point[]).map((e) => movedPoint(e, v, true));
  return [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]) as Matrix;
}

const DEGREES = 180 / Math.PI;

/**
 * Rotation `r` as a Move's three angles (degrees, about X, then Y, then Z:
 * r = Rz·Ry·Rx), each in (−180°, 180°]. Every rotation has two such
 * triples (a, b, c) and (a + 180°, 180° − b, c + 180°); the one turning
 * least in all (the smaller sum of sizes, the first on a tie) is taken, so
 * half a turn about Y reads 180° about Y, not 180° about X and Z. Each is
 * found from rows that stay well conditioned near b = ±90°: c from the
 * first column, then r turned back by c about Z is Ry·Rx, whose middle row
 * gives a and whose first column gives b.
 */
export function turnAngles(r: Matrix): [number, number, number] {
  const solve = (sign: number): [number, number, number] => {
    const c = Math.atan2(sign * r[1][0], sign * r[0][0]);
    const [cc, sc] = [Math.cos(c), Math.sin(c)];
    const m0 = [0, 1, 2].map((j) => cc * r[0][j] + sc * r[1][j]);
    const m1 = [0, 1, 2].map((j) => -sc * r[0][j] + cc * r[1][j]);
    const b = Math.atan2(-r[2][0], m0[0]);
    const a = Math.atan2(-m1[2], m1[1]);
    return [a, b, c].map((x) => {
      const d = x * DEGREES;
      return (d <= -180 ? d + 360 : d) + 0;
    }) as [number, number, number];
  };
  const [one, two] = [solve(1), solve(-1)];
  const size = (t: readonly number[]) => Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2]);
  return size(two) < size(one) ? two : one;
}

/** An angle (degrees) rounded to 1e-12°: rounding's dust gone (90.00000000000001 is 90), at most 2e-8 mm off at model space's 1 km edge. */
export const snapAngle = (d: number): number => Math.round(d * 1e12) / 1e12 + 0;
/** A distance (mm) rounded to 1e-9 mm, a thousandth of the kernel's 10 nm tolerance. */
export const snapDistance = (d: number): number => Math.round(d * 1e9) / 1e9 + 0;

/**
 * The Move's numbers that land `from` on `to` (35e2d), or why they can't:
 * `from` as it was before the Move (where its body was built), `to` where
 * the Move's result is seen. The turn the boxes hold (`v`) is turned on by
 * the smallest turn that lays `from` on `to`: a face's or round edge's
 * normal turned to point against `to`'s, a straight edge along `to`'s line
 * whichever way needs less turn, and a round side's axis along `to`'s the
 * same way; a sphere is not turned more. The pivot stays; the distance is
 * what then takes `from`'s point onto `to`'s. Each kind lands only on its
 * own kind: a face on a face, a straight edge on a straight edge, a round
 * edge on a round edge, a round side on a round side, a sphere on a sphere.
 */
export function snappedValues(v: MoveValues, from: SnapPart, to: SnapPart): { values: MoveValues } | { refused: string } {
  if (from.kind !== to.kind) return { refused: `${PART_WORDS[from.kind][0].toUpperCase()}${PART_WORDS[from.kind].slice(1)} lands only on ${PART_WORDS[from.kind]}: pick one on another body.` };
  let turnX = v.turnX;
  let turnY = v.turnY;
  let turnZ = v.turnZ;
  if (from.kind !== "centre" && to.kind !== "centre") {
    const now = unit(movedPoint(from.kind === "line" || from.kind === "axis" ? from.direction : from.normal, v, true));
    let want: Point;
    if (to.kind === "line" || to.kind === "axis") want = dot(now, to.direction) < 0 ? [-to.direction[0], -to.direction[1], -to.direction[2]] : to.direction;
    else want = [-to.normal[0], -to.normal[1], -to.normal[2]];
    [turnX, turnY, turnZ] = turnAngles(times(turnBetween(now, want), turnMatrix(v))).map(snapAngle);
  }
  const turned: MoveValues = { ...v, turnX, turnY, turnZ, x: 0, y: 0, z: 0 };
  const landed = movedPoint(from.point, turned);
  const [x, y, z] = [0, 1, 2].map((k) => snapDistance(to.point[k] - landed[k]));
  return { values: { ...turned, x, y, z } };
}

/**
 * The built Moves after Move `id` (null: a new Move, at the marker, with
 * none built after it) that move body `feature` too, in timeline order, and
 * Move `id`'s numbers as built (null when it is new or did not move
 * anything: suppressed, greyed, failed): what the scene's view of the body
 * has been through since the Move, as editedMoveMesh takes it.
 */
function movesSince(doc: DesignDocument, results: Readonly<Record<string, { status: string }>>, id: string | null, feature: string) {
  const at = id === null ? -1 : doc.timeline.features.findIndex((f) => f.id === id);
  if (at < 0) return { built: null, later: [] as MoveValues[] };
  const edited = doc.timeline.features[at];
  const built = isMoveItem(edited) && results[id!]?.status === "built" ? moveValues(edited) : null;
  const later = doc.timeline.features
    .slice(at + 1)
    .filter((f) => isMoveItem(f) && results[f.id]?.status === "built" && f.dependsOn.includes(feature))
    .map(moveValues);
  return { built, later };
}

/**
 * The two ends of a snap of Move `id` (null for a new one) as
 * snappedValues takes them, from parts as the scene shows them: `from` (on
 * body `fromBody`, which the Move moves) taken back through the built
 * Moves after this one that move its body (last first) and out of this
 * Move as built, so it is where its body was before the Move; `to` taken
 * back through those same later Moves, so landing there under this Move
 * puts it where `to` is seen once the later Moves have moved it on.
 */
export function snapEnds(doc: DesignDocument, results: Readonly<Record<string, { status: string }>>, id: string | null, fromBody: string, from: SnapPart, to: SnapPart): { from: SnapPart; to: SnapPart } {
  const { built, later } = movesSince(doc, results, id, fromBody);
  const back: PointMap = (p, vector) => {
    let q: readonly number[] = p;
    for (const m of [...later].reverse()) q = unmovedPoint(q, m, vector);
    return [q[0], q[1], q[2]];
  };
  const before: PointMap = (p, vector) => {
    const q = back(p, vector);
    return built === null ? q : unmovedPoint(q, built, vector);
  };
  return { from: mappedPart(from, before), to: mappedPart(to, back) };
}
