// The exact model for stacked face sketches (journeys/face-stack.journey.ts):
// a chain of prisms, the first on the XY plane, each after it sketched on a
// flat face of a prism before it and extruded, every one a new body (Design
// has no join yet; booleans' Combine, step 35, adds them). Written apart from
// Design and the kernel, from the rules alone:
// - a prism is its profile (a convex polygon's corners or a circle, in its
//   sketch's own (u, v)), its sketch's placement, a distance d > 0 and
//   whether it is flipped. A point (u, v) of the sketch lies at
//   origin + u x + v (normal × x) (naming-model.ts `worldOf`);
// - the extrude goes the way the sketch faces (side × normal), the other way
//   when flipped (rule 2 and Design's Flip);
// - a sketch on a face takes the frame of naming rule 8 when drawn (the
//   origin plane most nearly parallel to the face, turned onto it the
//   shortest way, origin where the world's origin meets the plane square on:
//   naming-model.ts `drawnFrame`), and after later edits the frame turned
//   with its face (`frameNow`), its side never changing;
// - so with A the profile's area (shoelace, or πr²) and P its perimeter, the
//   prism's volume is A d, its surface 2A + P d, its caps the profile at 0
//   and at d along the extrude, each side a rectangle |edge| × d facing
//   away from the profile's middle, its corners the profile's corners at
//   both ends (a circle's side is round, area 2πr d, middle on its axis).
// A chain's steps are drawn from a seed; each shape is made inside the face
// it is drawn on, so it can never be refused: a shrunk copy of the face, a
// triangle of its corners, a regular polygon or a circle round a point
// inside it, sometimes only micrometres across, never under SMALLEST.

import type { SeededRandom } from "./index.ts";
import { drawnFrame, frameNow, worldOf, type Drawn, type Placement, type Vec3 } from "./naming-model.ts";

export type P2 = readonly [number, number];
export type Shape = { kind: "polygon"; corners: P2[] } | { kind: "circle"; centre: P2; radius: number };

/** A face of a prism: a cap, or the side swept from the profile's k-th edge (corner k to k + 1). */
export type FaceKey = { role: "start" | "end" } | { role: "side"; edge: number };

/** One prism of the chain. `on` is null for the first (on XY); else the prism and face its sketch is drawn on, and the frame as drawn. */
export interface StackPrism {
  on: { prism: number; face: FaceKey; drawn: Drawn; side: 1 | -1 } | null;
  shape: Shape;
  distance: number;
  flip: boolean;
}

/** A face of a built prism, in the world. `outward` is null for a circle's round side. */
export interface ModelFace {
  key: FaceKey;
  outward: Vec3 | null;
  /** A polygon face's corners in order, a disc's centre and radius. */
  corners: Vec3[] | null;
  disc: { centre: Vec3; radius: number } | null;
  area: number;
  centroid: Vec3;
}

export interface ModelBody {
  placement: Placement;
  /** The extrude's unit direction and its length. */
  dir: Vec3;
  volume: number;
  area: number;
  centroid: Vec3;
  faces: ModelFace[];
  /** Every corner of a polygon prism, start cap's then end cap's; empty for a cylinder. */
  vertices: Vec3[];
}

/** The smallest size a shape or distance is made (mm): three times the kernel's 1 µm MIN_FEATURE, so nothing made is at the kernel's limit. */
export const SMALLEST = 3e-3;
/** The sharpest corner a made shape has (radians, half a degree). */
export const SHARPEST = Math.PI / 360;

// ------------------------------------------------------------ vectors

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a: Vec3) => Math.sqrt(dot(a, a));
export const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

// Both measured from the first corner, never the sketch's origin: a face a few micrometres across lying 200 mm from its
// sketch's origin has corners whose cross products (~4e4) cancel to an area of ~1e-5, losing 9 of the 16 digits (the first
// version of this model did, and its tiny faces' middles were 3e-7 mm off while the kernel's, measured from a corner, were right).
const from0 = (c: readonly P2[]): P2[] => c.map((q): P2 => [q[0] - c[0][0], q[1] - c[0][1]]);

/** Twice the signed area of a polygon (shoelace, about its first corner), positive counter-clockwise. */
export function twiceArea(corners: readonly P2[]): number {
  const c = from0(corners);
  let s = 0;
  for (let k = 0; k < c.length; k++) {
    const [a, b] = [c[k], c[(k + 1) % c.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/** A polygon's area centroid: c0 + Σ (a + b)(a × b) / (6 A), a and b measured from its first corner c0. */
export function polygonCentroid(corners: readonly P2[]): P2 {
  const c = from0(corners);
  let [x, y] = [0, 0];
  for (let k = 0; k < c.length; k++) {
    const [a, b] = [c[k], c[(k + 1) % c.length]];
    const w = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * w;
    y += (a[1] + b[1]) * w;
  }
  const six = 3 * twiceArea(corners);
  return [corners[0][0] + x / six, corners[0][1] + y / six];
}

const perimeter = (c: readonly P2[]) => c.reduce((s, a, k) => s + Math.hypot(c[(k + 1) % c.length][0] - a[0], c[(k + 1) % c.length][1] - a[1]), 0);

// ------------------------------------------------------------ building

export const faceName = (k: FaceKey) => (k.role === "side" ? `side:${k.edge}` : k.role);

/** Where a prism's sketch lies now: XY for the first, else its frame turned with the face it was drawn on (rule 8). */
function placementOf(p: StackPrism, built: readonly ModelBody[]): Placement {
  if (p.on === null) return { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1], side: 1 };
  const face = built[p.on.prism].faces.find((f) => faceName(f.key) === faceName(p.on!.face));
  if (!face || !face.outward) throw new Error(`prism ${p.on.prism} has no flat face ${faceName(p.on.face)}`);
  const point = face.corners ? face.corners[0] : face.disc!.centre;
  return { ...frameNow(p.on.drawn, p.on.side, face.outward, point), side: p.on.side };
}

/** One prism in the world, its sketch placed by `placement`. */
export function prismBody(p: StackPrism, placement: Placement): ModelBody {
  const way = (p.flip ? -1 : 1) * placement.side;
  const dir = scale(placement.normal, way);
  const d = p.distance;
  const D = scale(dir, d);
  const at = (q: P2) => worldOf(placement, q[0], q[1]);
  if (p.shape.kind === "circle") {
    const { centre, radius: r } = p.shape;
    const c = at(centre);
    const cap = Math.PI * r * r;
    return {
      placement,
      dir,
      volume: cap * d,
      area: 2 * cap + 2 * Math.PI * r * d,
      centroid: add(c, scale(D, 0.5)),
      faces: [
        { key: { role: "start" }, outward: scale(dir, -1), corners: null, disc: { centre: c, radius: r }, area: cap, centroid: c },
        { key: { role: "end" }, outward: dir, corners: null, disc: { centre: add(c, D), radius: r }, area: cap, centroid: add(c, D) },
        { key: { role: "side", edge: 0 }, outward: null, corners: null, disc: null, area: 2 * Math.PI * r * d, centroid: add(c, scale(D, 0.5)) },
      ],
      vertices: [],
    };
  }
  const cs = p.shape.corners;
  const A = Math.abs(twiceArea(cs)) / 2;
  const low = cs.map(at);
  const high = low.map((w) => add(w, D));
  const mid = at(polygonCentroid(cs));
  const faces: ModelFace[] = [
    { key: { role: "start" }, outward: scale(dir, -1), corners: low, disc: null, area: A, centroid: mid },
    { key: { role: "end" }, outward: dir, corners: high, disc: null, area: A, centroid: add(mid, D) },
  ];
  low.forEach((a, k) => {
    const b = low[(k + 1) % low.length];
    const n = unit(cross(sub(b, a), dir));
    const half = scale(add(a, b), 0.5);
    // Convex, so a side faces away from the profile's middle.
    const out = dot(n, sub(half, mid)) > 0 ? n : scale(n, -1);
    faces.push({ key: { role: "side", edge: k }, outward: out, corners: [a, b, add(b, D), add(a, D)], disc: null, area: norm(sub(b, a)) * d, centroid: add(half, scale(D, 0.5)) });
  });
  return { placement, dir, volume: A * d, area: 2 * A + perimeter(cs) * d, centroid: add(mid, scale(D, 0.5)), faces, vertices: [...low, ...high] };
}

/** Every prism of the chain in the world, in order. */
export function buildStack(chain: readonly StackPrism[]): ModelBody[] {
  const built: ModelBody[] = [];
  for (const p of chain) built.push(prismBody(p, placementOf(p, built)));
  return built;
}

/** The frame a sketch drawn now on `face` gets (rule 8), as the model keeps it. */
export function drawnOn(face: ModelFace): { drawn: Drawn; side: 1 | -1; placement: Placement } {
  const f = drawnFrame(face.outward!);
  const point = face.corners ? face.corners[0] : face.disc!.centre;
  const origin = scale(f.normal, dot(point, f.normal));
  return { drawn: { outward: face.outward!, x: f.x, normal: f.normal, origin, centroid: [0, 0] }, side: f.side, placement: { origin, x: f.x, normal: f.normal, side: f.side } };
}

/** A world point in a placement's (u, v). */
export function local(p: Placement, w: Vec3): P2 {
  const r = sub(w, p.origin);
  return [dot(r, p.x), dot(r, cross(p.normal, p.x))];
}

/**
 * How close the face's normal is to a tie between two origin planes (the
 * gap between the two largest |outward · plane normal|): below TIE_GAP the
 * kernel's normal, a few ulps off the model's, could pick the other plane,
 * so the chain never draws on such a face.
 */
export function tieGap(outward: Vec3): number {
  const a = [Math.abs(outward[2]), Math.abs(outward[1]), Math.abs(outward[0])].sort((x, y) => y - x);
  return a[0] - a[1];
}
export const TIE_GAP = 1e-6;

// ------------------------------------------------------------ shapes inside a face

/** The distance from p to the nearest side of a convex polygon (positive inside). */
function inset(p: P2, c: readonly P2[]): number {
  const ccw = twiceArea(c) > 0 ? 1 : -1;
  let best = Infinity;
  for (let k = 0; k < c.length; k++) {
    const [a, b] = [c[k], c[(k + 1) % c.length]];
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
    best = Math.min(best, (ccw * (ex * (p[1] - a[1]) - ey * (p[0] - a[0]))) / Math.hypot(ex, ey));
  }
  return best;
}

/** Whether a polygon is one the chain may draw: convex, every side and every height at least SMALLEST, no corner sharper than SHARPEST. */
export function drawable(c: readonly P2[]): boolean {
  const n = c.length;
  if (n < 3) return false;
  const ccw = twiceArea(c) > 0 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const [a, b, e] = [c[(k + n - 1) % n], c[k], c[(k + 1) % n]];
    const [u, v] = [
      [b[0] - a[0], b[1] - a[1]],
      [e[0] - b[0], e[1] - b[1]],
    ];
    if (Math.hypot(v[0], v[1]) < SMALLEST) return false;
    const turn = ccw * (u[0] * v[1] - u[1] * v[0]);
    if (turn <= 0) return false;
    // The corner's angle inside is π − the turn's angle.
    const inner = Math.PI - Math.atan2(turn, u[0] * v[0] + u[1] * v[1]);
    if (inner < SHARPEST) return false;
    // Every other corner at least SMALLEST from the line of side k → k + 1.
    for (let j = 0; j < n; j++) {
      if (j === k || j === (k + 1) % n) continue;
      const h = (ccw * (v[0] * (c[j][1] - b[1]) - v[1] * (c[j][0] - b[0]))) / Math.hypot(v[0], v[1]);
      if (h < SMALLEST) return false;
    }
  }
  return true;
}

/** The kinds of shape a chain draws. */
export type ShapeKind = "copy" | "triangle" | "regular" | "circle";

/**
 * A shape inside `face` (seen in `placement`'s (u, v)), of kind `kind`,
 * about `size` times the face, or null when that one can't be made
 * drawable there (too small, too thin).
 */
export function shapeIn(face: ModelFace, placement: Placement, r: SeededRandom, kind: ShapeKind, size: number): Shape | null {
  let corners: P2[];
  let room: (p: P2) => number;
  let pick: () => P2;
  if (face.disc) {
    const c = local(placement, face.disc.centre);
    const R = face.disc.radius;
    // A disc's corners for copies and triangles: a regular hexagon inside it, turned at random.
    const turn = r.next() * 2 * Math.PI;
    corners = Array.from({ length: 6 }, (_, k): P2 => [c[0] + R * Math.cos(turn + (k * Math.PI) / 3), c[1] + R * Math.sin(turn + (k * Math.PI) / 3)]);
    room = (p) => R - Math.hypot(p[0] - c[0], p[1] - c[1]);
    pick = () => {
      const [a, t] = [r.next() * 2 * Math.PI, 0.6 * R * Math.sqrt(r.next())];
      return [c[0] + t * Math.cos(a), c[1] + t * Math.sin(a)];
    };
  } else {
    corners = face.corners!.map((w) => local(placement, w));
    room = (p) => inset(p, corners);
    // A random point inside: a mix of the corners with random weights, pulled a little toward the middle.
    pick = () => {
      const w = corners.map(() => r.next() + 0.05);
      const s = w.reduce((x, y) => x + y, 0);
      return [corners.reduce((x, q, k) => x + (q[0] * w[k]) / s, 0), corners.reduce((x, q, k) => x + (q[1] * w[k]) / s, 0)];
    };
  }
  const p = pick();
  const toward = (q: P2): P2 => [p[0] + size * (q[0] - p[0]), p[1] + size * (q[1] - p[1])];
  let shape: Shape;
  if (kind === "copy") shape = { kind: "polygon", corners: corners.map(toward) };
  else if (kind === "triangle") {
    const n = corners.length;
    const [i, j, k] = [Math.floor(r.next() * n), Math.floor(r.next() * n), Math.floor(r.next() * n)].sort((a, b) => a - b);
    if (i === j || j === k) return null;
    shape = { kind: "polygon", corners: [corners[i], corners[j], corners[k]].map(toward) };
  } else {
    const rho = size * room(p);
    if (!(rho >= SMALLEST)) return null;
    if (kind === "circle") shape = { kind: "circle", centre: p, radius: rho };
    else {
      const n = 3 + Math.floor(r.next() * 6);
      const turn = r.next() * 2 * Math.PI;
      shape = { kind: "polygon", corners: Array.from({ length: n }, (_, k): P2 => [p[0] + rho * Math.cos(turn + (2 * Math.PI * k) / n), p[1] + rho * Math.sin(turn + (2 * Math.PI * k) / n)]) };
    }
  }
  if (shape.kind === "polygon" && !drawable(shape.corners)) return null;
  return shape;
}

// ------------------------------------------------------------ seeded chains

/** A step after the chain is built: an earlier extrude's distance or flip changed, or a corner of the first outline moved. */
export type StackEdit = { kind: "distance"; prism: number; distance: number } | { kind: "flip"; prism: number } | { kind: "corner"; corner: number; to: P2 };

/** A seeded chain: how to draw each prism, then the edits. */
export interface StackChain {
  seed: bigint;
  prisms: StackPrism[];
  edits: StackEdit[];
  /** What the chain reached, for the journey's coverage counts. */
  tags: string[][];
}

/** A distance: mostly 0.5 to 40 mm, sometimes micrometres, sometimes hundreds of mm. */
export function randomDistance(r: SeededRandom): number {
  const x = r.next();
  if (x < 0.15) return SMALLEST + r.next() * 0.05;
  if (x < 0.3) return 40 + r.next() * 260;
  return 0.5 + r.next() * 39.5;
}

/** The first outline: a convex polygon of 3 to 7 corners round the origin, 5 to 40 mm across, never at a tie between origin planes. */
function firstOutline(r: SeededRandom): P2[] {
  for (;;) {
    const n = 3 + Math.floor(r.next() * 5);
    const start = r.next() * 2 * Math.PI;
    const R = 5 + r.next() * 35;
    // Corners on a circle at sorted random angles (so the polygon is convex), shifted off the origin.
    const angles = Array.from({ length: n }, () => r.next() * 2 * Math.PI).sort((a, b) => a - b);
    const [ox, oy] = [(r.next() - 0.5) * 40, (r.next() - 0.5) * 40];
    const c = angles.map((a): P2 => [ox + R * Math.cos(start + a), oy + R * Math.sin(start + a)]);
    if (drawable(c) && Math.min(...c.map((_, k) => Math.hypot(c[(k + 1) % n][0] - c[k][0], c[(k + 1) % n][1] - c[k][1]))) > 1) return c;
  }
}

/** The flat faces of a built prism the chain may draw on. */
const drawableFaces = (b: ModelBody) => b.faces.filter((f) => f.outward !== null && tieGap(f.outward) >= TIE_GAP);

const pickOf = <T>(r: SeededRandom, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];

/**
 * A chain from `seed`: the first prism on XY, then `length` − 1 prisms each
 * on a random flat face (half the time of the last prism, else of any),
 * then `edits` edits. The same seed gives the same chain, and a shorter
 * one is its start (steps are drawn in order), so a failure shrinks by
 * cutting the chain short.
 */
export function randomChain(seed: bigint, r: SeededRandom, length: number, edits: number): StackChain {
  const first = firstOutline(r);
  const prisms: StackPrism[] = [{ on: null, shape: { kind: "polygon", corners: twiceArea(first) > 0 || r.next() < 0.5 ? first : [...first].reverse() }, distance: randomDistance(r), flip: r.next() < 0.25 }];
  const tags: string[][] = [["xy"]];
  while (prisms.length < length) {
    const built = buildStack(prisms);
    const which = r.next() < 0.5 ? built.length - 1 : Math.floor(r.next() * built.length);
    const faces = drawableFaces(built[which]);
    if (faces.length === 0) continue;
    const face = pickOf(r, faces);
    const kind = pickOf<ShapeKind>(r, ["copy", "triangle", "regular", "circle"]);
    const tiny = r.next() < 0.12;
    const { drawn, side, placement } = drawnOn(face);
    // Mostly a fair share of the face; sometimes only a few micrometres (but never under SMALLEST).
    const across = face.disc ? 2 * face.disc.radius : Math.sqrt(face.area);
    const size = tiny ? Math.min(0.9, (SMALLEST * (2 + 20 * r.next())) / across) : 0.15 + 0.8 * r.next();
    const shape = shapeIn(face, placement, r, kind, size);
    if (!shape) continue;
    const flip = r.next() < 0.25;
    prisms.push({ on: { prism: which, face: face.key, drawn, side }, shape, distance: randomDistance(r), flip });
    const slanted = Math.max(...face.outward!.map(Math.abs)) < 1 - 1e-9;
    tags.push([
      face.key.role === "side" ? "on-side" : `on-${face.key.role}`,
      kind,
      ...(face.disc ? ["on-disc"] : []),
      ...(slanted ? ["slanted"] : []),
      ...(side < 0 ? ["side-back"] : []),
      ...(flip ? ["flipped"] : []),
      ...(face.area < 1e-2 ? ["tiny-face"] : []),
      ...(which !== built.length - 1 ? ["on-older"] : []),
      ...(prisms.length >= 5 ? ["deep"] : []),
    ]);
  }
  const list: StackEdit[] = [];
  for (let k = 0; k < edits; k++) {
    const x = r.next();
    if (x < 0.45) list.push({ kind: "distance", prism: Math.floor(r.next() * prisms.length), distance: randomDistance(r) });
    else if (x < 0.7) list.push({ kind: "flip", prism: Math.floor(r.next() * prisms.length) });
    else {
      const c = (prisms[0].shape as { corners: P2[] }).corners;
      const at = Math.floor(r.next() * c.length);
      list.push({ kind: "corner", corner: at, to: [c[at][0] + (r.next() - 0.5) * 4, c[at][1] + (r.next() - 0.5) * 4] });
    }
  }
  return { seed, prisms, edits: list, tags };
}

/** The chain after an edit, or null when the edit would spoil the first outline (a moved corner making it concave, thin or sharp): such an edit is skipped. */
export function edited(chain: readonly StackPrism[], e: StackEdit): StackPrism[] | null {
  const out = chain.map((p) => ({ ...p }));
  if (e.kind === "distance") out[e.prism].distance = e.distance;
  else if (e.kind === "flip") out[e.prism].flip = !out[e.prism].flip;
  else {
    const c = [...(out[0].shape as { corners: P2[] }).corners];
    c[e.corner] = e.to;
    if (!drawable(c) || Math.min(...c.map((_, k) => Math.hypot(c[(k + 1) % c.length][0] - c[k][0], c[(k + 1) % c.length][1] - c[k][1]))) <= 1) return null;
    out[0].shape = { kind: "polygon", corners: c };
  }
  return out;
}
