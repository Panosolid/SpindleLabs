// Names on a boolean's result (step 35ec2): rules 1 to 4 of section 8 of
// docs/document-model.md, worked from the kernel's own record of where
// each result face came from (`BooleanResult.history`), never from where
// the faces are.
//
// - Rule 2: a result face keeps every name of the input face it lies on,
//   whichever feature made that face: a hole's wall is the cut tool's side.
// - Rule 4: faces of the inputs ending up as one face answer to all their
//   names, the target's first. The kernel refuses faces lying on each other
//   until step 36a, so today each result face has one origin; a face with
//   several (`origins`) is ready for the day its history gives them.
// - Rule 1: a cut or intersect leaving the target in pieces: walk the
//   target's faces in made order (`made`, then lowest corner); the piece
//   holding the first face whose surviving part lies wholly in one piece
//   keeps the target's id. Every piece is ranked by the first face reaching
//   it, its share of that face (larger first), its volume (larger first),
//   its lowest corner (smaller x, then y, then z); with no face wholly in
//   one piece the first by rank keeps the id. A join: the piece holding the
//   target keeps it, whatever its faces. Every other piece is
//   `body:<feature>/piece:<k>`, k counting on from `firstPiece`.
// - Rule 3: two or more faces carrying one name (anywhere in the design)
//   each add a tag: the sorted shown names of the faces bordering it that
//   border none of the others (`fullNames`).
//
// The exact model these answer to is packages/testing's
// boolean-naming-model.ts (`rebuildBooleans`); the tests compare the two
// on the real kernel (test/boolean-names.test.ts).

import type { BodyHandle, BodyView, BooleanOp, BooleanResult, FaceRole } from "@fission/core";
import type { BodyNames } from "./naming.ts";

/** A face's names, the one shown first. */
export interface FaceNames {
  /** Every full face name it answers to, the one shown first; empty when it has none (a name two faces would share). */
  names: readonly string[];
}

/** A body with a name on each face, by kernel face index: what a boolean takes in and gives. */
export interface NamedBody {
  /** Its body id: `body:feature-2`, `body:feature-9/piece:1`. */
  id: string;
  handle: BodyHandle;
  view: BodyView;
  faces: readonly FaceNames[];
  /** Where each name comes in made order: its feature's place in the timeline, then that feature's own order of its faces. */
  made: ReadonlyMap<string, readonly number[]>;
}

/**
 * Corners closer than this on an axis are the same corner: the kernel's
 * LINEAR (10 nm), the distance within which it treats two points as one.
 * Two pieces' lowest corners nearer than that are compared on the next
 * axis, so a rounding in the last bits never decides a name.
 */
export const SAME_CORNER = 1e-5;

/**
 * Areas and volumes within a billionth of the larger count as equal
 * (section 8: they are sums of rounded products), as the model's TIE.
 */
export const TIE = 1e-9;

/** A feature's own order of its faces (section 8): an extrude's start, end, then sides in the outline's order; a box's bottom, top, front, back, left, right; a cylinder's bottom, top, side; a sphere's lower, upper. */
const ROLE_ORDER: Record<FaceRole["role"], number> = { start: 0, end: 1, side: 2, bottom: 0, top: 1, front: 2, back: 3, left: 4, right: 5, lower: 0, upper: 1 };

/** Where a face of role `r` comes in its feature's own order: its role, then (a side) its loop and piece. */
export function roleOrder(r: FaceRole | null): number[] {
  if (r === null) return [Infinity];
  return [ROLE_ORDER[r.role] ?? Infinity, r.boundary ?? 0, r.piece ?? 0];
}

/**
 * The body a feature built as a `NamedBody`: each face's full name
 * ("face:feature-2/side:line-1") from `names` (naming.ts), made order its
 * feature's `place` in the timeline then the face's role.
 */
export function featureBody(id: string, handle: BodyHandle, view: BodyView, names: BodyNames, place: number): NamedBody {
  const made = new Map<string, readonly number[]>();
  const faces = names.faces.map((part, f) => {
    if (part === null) return { names: [] };
    const name = `face:${names.feature}/${part}`;
    made.set(name, [place, ...roleOrder(view.face_roles[f] ?? null)]);
    return { names: [name] };
  });
  return { id, handle, view, faces, made };
}

/** Compares corners smallest x first, then y, then z, coordinates within SAME_CORNER counting as one. */
export function cornerCompare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (Math.abs(a[i] - b[i]) >= SAME_CORNER) return a[i] - b[i];
  return 0;
}

/** Compares two sizes, larger first, within TIE of the larger counting as equal. */
export function sizeCompare(a: number, b: number): number {
  return Math.abs(a - b) <= TIE * Math.max(Math.abs(a), Math.abs(b)) ? 0 : b - a;
}

const lex = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? -Infinity, b[i] ?? -Infinity];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** The lowest of some corners (cornerCompare). */
function lowest(points: readonly (readonly number[])[]): readonly number[] {
  let low = points[0] ?? [Infinity, Infinity, Infinity];
  for (const p of points) if (cornerCompare(p, low) < 0) low = p;
  return low;
}

/** Face `f`'s lowest corner: the lowest end of the edges round it (a flat face's lowest point is one of its corners). */
export function faceLow(view: BodyView, f: number): readonly number[] {
  const points: (readonly number[])[] = [];
  view.edge_faces.forEach((pair, e) => {
    if (pair !== null && (pair[0] === f || pair[1] === f)) for (const v of view.edge_vertices[e] ?? []) points.push(view.vertex_points[v]);
  });
  return lowest(points);
}

/** The body's lowest corner (a solid bounded by flat faces has its lowest point at a corner). */
export const bodyLow = (view: BodyView): readonly number[] => lowest(view.vertex_points);

/** What `combineNames` gives: the result bodies named, the keeper first then the new pieces in rank order, and the next piece number; or why it failed. */
export type CombineNames = { bodies: NamedBody[]; nextPiece: number } | { failed: string };

/**
 * Names the result of `body_boolean(target, tools, op)` run by `feature`
 * (a Combine): `result` the kernel's answer, `views` each result body's
 * view in the same order. New pieces count from `firstPiece`.
 */
export function combineNames(feature: string, op: BooleanOp, target: NamedBody, tools: readonly NamedBody[], result: BooleanResult, views: readonly BodyView[], firstPiece = 1): CombineNames {
  if (result.bodies.length === 0) return { failed: `it would leave nothing of ${target.id}` };
  if (views.length !== result.bodies.length || result.history.length !== result.bodies.length) throw new Error("each result body needs its view and its history");
  const inputs = new Map<BodyHandle, { body: NamedBody; order: number }>();
  [target, ...tools].forEach((b, order) => inputs.set(b.handle, { body: b, order }));
  const made = new Map<string, readonly number[]>();
  for (const b of [target, ...tools]) for (const [n, m] of b.made) if (!made.has(n)) made.set(n, m);

  // Rules 2 and 4: each result face's names, from the input faces it lies on.
  const named = result.history.map((h) =>
    h.faces.map((from) => {
      const input = inputs.get(from.body);
      if (input === undefined) throw new Error(`the result names a body that was not an input (${from.body})`);
      return { names: input.body.faces[from.face]?.names ?? [] };
    }),
  );

  // Rule 1: which piece keeps the target's id, and the order of the rest.
  const count = result.bodies.length;
  const first = new Array<number>(count).fill(Infinity);
  const share = new Array<number>(count).fill(0);
  let keeper = -1;
  if (op === "union") keeper = holderOf(target, result, views);
  const walk = target.faces
    .map((f, i) => ({ i, made: f.names.length > 0 ? (made.get(f.names[0]) ?? [Infinity]) : [Infinity], low: faceLow(target.view, i) }))
    .sort((a, b) => lex(a.made, b.made) || cornerCompare(a.low, b.low));
  walk.forEach((w, step) => {
    const reach = new Map<number, number>();
    result.history.forEach((h, p) =>
      h.faces.forEach((from, j) => {
        if (from.body === target.handle && from.face === w.i) reach.set(p, (reach.get(p) ?? 0) + views[p].face_areas[j]);
      }),
    );
    for (const [p, area] of reach)
      if (first[p] === Infinity) {
        first[p] = step;
        share[p] = area;
      }
    if (keeper < 0 && reach.size === 1) keeper = [...reach.keys()][0];
  });
  const lows = views.map(bodyLow);
  const order = [...Array(count).keys()].sort(
    (p, q) => first[p] - first[q] || sizeCompare(share[p], share[q]) || sizeCompare(views[p].volume, views[q].volume) || cornerCompare(lows[p], lows[q]) || p - q,
  );
  if (keeper < 0) keeper = order[0];
  const rest = order.filter((p) => p !== keeper);
  const body = (p: number, id: string): NamedBody => ({ id, handle: result.bodies[p], view: views[p], faces: named[p], made });
  return {
    bodies: [body(keeper, target.id), ...rest.map((p, i) => body(p, `body:${feature}/piece:${firstPiece + i}`))],
    nextPiece: firstPiece + rest.length,
  };
}

/**
 * The piece of a union holding the target: the one with a face from it;
 * when a tool swallowed it whole (no face of it left), the smallest piece
 * whose box holds the target's box, as the pieces are apart solids and
 * the target lies inside one of them.
 */
function holderOf(target: NamedBody, result: BooleanResult, views: readonly BodyView[]): number {
  const withFace = result.history.findIndex((h) => h.faces.some((f) => f.body === target.handle));
  if (withFace >= 0) return withFace;
  const [lo, hi] = target.view.bounds;
  const holds = (p: number) => [0, 1, 2].every((i) => views[p].bounds[0][i] <= lo[i] + SAME_CORNER && views[p].bounds[1][i] >= hi[i] - SAME_CORNER);
  const size = (p: number) => [0, 1, 2].reduce((v, i) => v * (views[p].bounds[1][i] - views[p].bounds[0][i]), 1);
  const candidates = [...views.keys()].filter(holds).sort((p, q) => size(p) - size(q));
  return candidates[0] ?? 0;
}

/**
 * Rule 3 across every body of the design: each face's full name, its
 * shown name with a tag when another face carries that name too (`name#`
 * then the tag's names joined by ","); null for a face with no name.
 */
export function fullNames(bodies: readonly NamedBody[]): (string | null)[][] {
  const all: { body: number; face: number; names: readonly string[] }[] = [];
  const at = bodies.map((b, bi) => b.faces.map((f, fi) => all.push({ body: bi, face: fi, names: f.names }) - 1));
  const shown = (k: number) => all[k].names[0] ?? null;
  const neighbours = all.map(() => new Set<string>());
  bodies.forEach((b, bi) =>
    b.view.edge_faces.forEach((pair) => {
      if (pair === null) return;
      const [x, y] = [at[bi][pair[0]], at[bi][pair[1]]];
      if (x === undefined || y === undefined) return;
      const [sx, sy] = [shown(x), shown(y)];
      if (sy !== null) neighbours[x].add(sy);
      if (sx !== null) neighbours[y].add(sx);
    }),
  );
  const carrying = new Map<string, number[]>();
  all.forEach((x, k) => {
    for (const n of new Set(x.names)) carrying.set(n, [...(carrying.get(n) ?? []), k]);
  });
  return at.map((faces) =>
    faces.map((k) => {
      const name = shown(k);
      if (name === null) return null;
      const pieces = carrying.get(name) ?? [k];
      return pieces.length > 1 ? `${name}#${tagAmong(k, pieces, (p) => neighbours[p]).join(",")}` : name;
    }),
  );
}

/** Rule 3's tag of face `face` among `pieces` (every face carrying one name): its neighbours' shown names that border none of the other pieces, sorted. */
export function tagAmong(face: number, pieces: readonly number[], neighbours: (f: number) => ReadonlySet<string>): string[] {
  const others = new Set<string>();
  for (const p of pieces) if (p !== face) for (const n of neighbours(p)) others.add(n);
  return [...neighbours(face)].filter((n) => !others.has(n)).sort();
}
