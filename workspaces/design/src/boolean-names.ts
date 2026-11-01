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
 * when a tool swallowed it whole (no face of it left), the piece whose
 * solid holds a corner of the target (the target's surface lies inside
 * the piece, as no face of it is left and faces lying on each other are
 * refused until 36a). Only pieces whose box holds the target's box are
 * tried, smallest box first; a box alone cannot tell (a ring round a bar
 * holding the target, review 35ed3).
 */
function holderOf(target: NamedBody, result: BooleanResult, views: readonly BodyView[]): number {
  const withFace = result.history.findIndex((h) => h.faces.some((f) => f.body === target.handle));
  if (withFace >= 0) return withFace;
  const [lo, hi] = target.view.bounds;
  const holds = (p: number) => [0, 1, 2].every((i) => views[p].bounds[0][i] <= lo[i] + SAME_CORNER && views[p].bounds[1][i] >= hi[i] - SAME_CORNER);
  const size = (p: number) => [0, 1, 2].reduce((v, i) => v * (views[p].bounds[1][i] - views[p].bounds[0][i]), 1);
  const candidates = [...views.keys()].filter(holds).sort((p, q) => size(p) - size(q));
  const corner = target.view.vertex_points[0];
  return (corner === undefined ? undefined : candidates.find((p) => solidHolds(views[p], corner))) ?? candidates[0] ?? 0;
}

/** A ray direction no axis-aligned face or edge of a flat body is likely to graze (its parts are irrational-looking and unequal). */
const RAY = [0.5390427, 0.3307021, 0.7745967];

/**
 * Whether point `p`, not on the body's surface, lies inside the body: a
 * ray from it crosses the display mesh's triangles an odd number of times
 * (Möller and Trumbore's ray-triangle test). Flat faces are triangulated
 * exactly, so the mesh is the body's surface.
 */
export function solidHolds(view: BodyView, p: readonly number[]): boolean {
  const { positions, indices } = view.mesh;
  const pt = (i: number) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let crossings = 0;
  for (let t = 0; 3 * t < indices.length; t++) {
    const a = pt(indices[3 * t]);
    const e1 = sub(pt(indices[3 * t + 1]), a);
    const e2 = sub(pt(indices[3 * t + 2]), a);
    const h = cross(RAY, e2);
    const det = dot(e1, h);
    if (det === 0) continue; // the ray runs along the triangle's plane
    const s = sub(p, a);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(RAY, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 0) crossings++;
  }
  return crossings % 2 === 1;
}

/** Every face of the design in one list, with what rules 3 and 5 read off it: its neighbours' shown names and the faces carrying each name. */
function faceTable(bodies: readonly NamedBody[]) {
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
  /** Face k's tag among the faces carrying `name`. */
  const tagOf = (k: number, name: string) => tagAmong(k, carrying.get(name) ?? [k], (p) => neighbours[p]);
  return { all, at, shown, carrying, tagOf };
}

/**
 * Rule 3 across every body of the design: each face's full name, its
 * shown name with a tag when another face carries that name too (`name#`
 * then the tag's names joined by ","); null for a face with no name.
 */
export function fullNames(bodies: readonly NamedBody[]): (string | null)[][] {
  const { at, shown, carrying, tagOf } = faceTable(bodies);
  return at.map((faces) =>
    faces.map((k) => {
      const name = shown(k);
      if (name === null) return null;
      return (carrying.get(name)?.length ?? 1) > 1 ? `${name}#${tagOf(k, name).join(",")}` : name;
    }),
  );
}

/** Rule 3's tag of face `face` among `pieces` (every face carrying one name): its neighbours' shown names that border none of the other pieces, sorted. */
export function tagAmong(face: number, pieces: readonly number[], neighbours: (f: number) => ReadonlySet<string>): string[] {
  const others = new Set<string>();
  for (const p of pieces) if (p !== face) for (const n of neighbours(p)) others.add(n);
  return [...neighbours(face)].filter((n) => !others.has(n)).sort();
}

// Edges and references (step 35ec3) ------------------------------------------

/** An edge of a body named by rule 5: its two faces' full names sorted, the other faces at its two ends, and its name. */
export interface EdgeName {
  /** Rule 5's name; null when another edge would have it too (shared, never guessed). */
  name: string | null;
  faces: readonly [string, string];
  /** The shown names of the other faces meeting at its two ends, sorted, without repeats. */
  ends: readonly string[];
}

/** Rule 3 and 5's names across every body of the design, and the tag reader references need. */
export interface DesignNames {
  /** Each face's full name by body and kernel face index (fullNames). */
  full: (string | null)[][];
  /** Each edge by body and kernel edge index; null for an edge with a face that has no name. */
  edges: (EdgeName | null)[][];
  /** Face `face` of body `body`'s tag among every face carrying `name`. */
  tagFor: (body: number, face: number, name: string) => string[];
}

/**
 * Rule 5 on every body: each edge `edge:<face>+<face>`, its two faces'
 * full names sorted; when two edges anywhere in the design have the same
 * two, `;ends:` and the shown names of the other faces meeting at its two
 * ends (sorted, by the kernel's `edge_vertices`); a name still given twice
 * is null for both, never guessed.
 *
 * Section 8's `;corner:` fallback (two sides of one outline meeting twice
 * with tied ends) is not here: only curves meet twice, and the kernel
 * refuses curved faces in a boolean until steps 37 and 38a; two straight
 * sides cross in one line, so the edges they share on a boolean's result
 * lie at the same corner and its name would not tell them apart either.
 */
export function designNames(bodies: readonly NamedBody[]): DesignNames {
  const table = faceTable(bodies);
  const full = fullNames(bodies);
  const raw = bodies.map((b, bi) => {
    const view = b.view;
    const atVertex: number[][] = view.vertex_points.map(() => []);
    view.edge_vertices.forEach((vs, e) => {
      for (const v of new Set(vs)) atVertex[v]?.push(e);
    });
    return view.edge_faces.map((pair, e) => {
      if (pair === null) return null;
      const [fa, fb] = [full[bi][pair[0]] ?? null, full[bi][pair[1]] ?? null];
      if (fa === null || fb === null) return null;
      const ends = new Set<string>();
      for (const v of new Set(view.edge_vertices[e] ?? []))
        for (const o of atVertex[v] ?? [])
          for (const f of view.edge_faces[o] ?? []) {
            const n = b.faces[f]?.names[0];
            if (f !== pair[0] && f !== pair[1] && n !== undefined) ends.add(n);
          }
      return { faces: [fa, fb].sort() as [string, string], ends: [...ends].sort() };
    });
  });
  const pairOf = (e: { faces: readonly [string, string] }) => `edge:${e.faces.join("+")}`;
  const pairs = new Map<string, number>();
  for (const body of raw) for (const e of body) if (e !== null) pairs.set(pairOf(e), (pairs.get(pairOf(e)) ?? 0) + 1);
  const said = raw.map((body) => body.map((e) => (e === null ? null : pairs.get(pairOf(e))! > 1 ? `${pairOf(e)};ends:${e.ends.join(",")}` : pairOf(e))));
  const count = new Map<string, number>();
  for (const body of said) for (const n of body) if (n !== null) count.set(n, (count.get(n) ?? 0) + 1);
  const edges = raw.map((body, bi) => body.map((e, k) => (e === null ? null : { ...e, name: count.get(said[bi][k]!) === 1 ? said[bi][k] : null })));
  return { full, edges, tagFor: (body, face, name) => table.tagOf(table.at[body][face], name) };
}

/** A face reference by name (a sketch's plane): the name it holds, the tag it was made with on a piece, and the sketch's origin. */
export interface FaceNameReference {
  name: string;
  tag?: readonly string[];
  origin?: readonly [number, number, number];
}

/** What a reference finds on the design's bodies: a face or edge by body and kernel index; two or more, never guessed between; or none. */
export type NameFound = { body: number; index: number; warning: "split" | null } | { ambiguous: number } | { lost: true };

/**
 * Whether face `f` of `view` holds point `p`: within SAME_CORNER of one of
 * its display triangles (flat faces are triangulated exactly, so their
 * triangles cover the face and nothing else), its edges counting as inside.
 */
export function faceHolds(view: BodyView, f: number, p: readonly number[]): boolean {
  const { positions, indices, triangle_faces } = view.mesh;
  const pt = (i: number) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const sub = (a: number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let t = 0; t < triangle_faces.length; t++) {
    if (triangle_faces[t] !== f) continue;
    const [a, b, c] = [pt(indices[3 * t]), pt(indices[3 * t + 1]), pt(indices[3 * t + 2])];
    // The closest point of the triangle to p (Ericson, Real-Time Collision Detection 5.1.5), then its distance.
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub([...p], a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    let q: number[];
    if (d1 <= 0 && d2 <= 0) q = a;
    else {
      const bp = sub([...p], b);
      const [d3, d4] = [dot(ab, bp), dot(ac, bp)];
      const cp = sub([...p], c);
      const [d5, d6] = [dot(ab, cp), dot(ac, cp)];
      const vc = d1 * d4 - d3 * d2;
      const vb = d5 * d2 - d1 * d6;
      const va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) q = b;
      else if (d6 >= 0 && d5 <= d6) q = c;
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = a.map((x, i) => x + (d1 / (d1 - d3)) * ab[i]);
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = a.map((x, i) => x + (d2 / (d2 - d6)) * ac[i]);
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = b.map((x, i) => x + ((d4 - d3) / (d4 - d3 + (d5 - d6))) * (c[i] - b[i]));
      else {
        const den = 1 / (va + vb + vc);
        q = a.map((x, i) => x + ab[i] * vb * den + ac[i] * vc * den);
      }
    }
    const d = sub(q, p);
    if (dot(d, d) <= SAME_CORNER * SAME_CORNER) return true;
  }
  return false;
}

/**
 * Rule 3's references on the design's bodies: one face carrying the name
 * is it (a tagged reference too: the face is whole again); among pieces a
 * tagged reference takes the one piece with its tag; one made on the whole
 * face takes the piece holding its origin, else the largest, with a
 * warning. Two pieces with the same tag, or two largest (within TIE), are
 * never guessed between.
 */
export function resolveFaceName(bodies: readonly NamedBody[], names: DesignNames, ref: FaceNameReference): NameFound {
  const pieces = bodies.flatMap((b, body) => b.faces.flatMap((f, index) => (f.names.includes(ref.name) ? [{ body, index }] : [])));
  if (pieces.length === 0) return { lost: true };
  if (pieces.length === 1) return { ...pieces[0], warning: null };
  if (ref.tag !== undefined) {
    const want = ref.tag.join(",");
    const match = pieces.filter((p) => names.tagFor(p.body, p.index, ref.name).join(",") === want);
    if (match.length === 0) return { lost: true };
    if (match.length > 1) return { ambiguous: match.length };
    return { ...match[0], warning: null };
  }
  const origin = ref.origin;
  const holding = origin === undefined ? [] : pieces.filter((p) => faceHolds(bodies[p.body].view, p.index, origin));
  if (holding.length === 1) return { ...holding[0], warning: "split" };
  const area = (p: { body: number; index: number }) => bodies[p.body].view.face_areas[p.index];
  const largest = Math.max(...pieces.map(area));
  const big = pieces.filter((p) => sizeCompare(area(p), largest) === 0);
  if (big.length > 1) return { ambiguous: big.length };
  return { ...big[0], warning: "split" };
}

/**
 * An edge by rule 5's name: found when exactly one edge has it. When two or
 * more edges fit it (its two faces now meet more than once, so they carry
 * `;ends:` the name never had, or even their ends tie and they are shared),
 * ambiguous, never guessed; else lost.
 */
export function resolveEdgeName(names: DesignNames, name: string): NameFound {
  let fits = 0;
  for (const [body, edges] of names.edges.entries())
    for (const [index, e] of edges.entries()) {
      if (e === null) continue;
      if (e.name === name) return { body, index, warning: null };
      const pair = `edge:${e.faces.join("+")}`;
      if (name === pair || name === `${pair};ends:${e.ends.join(",")}`) fits++;
    }
  return fits > 1 ? { ambiguous: fits } : { lost: true };
}

/**
 * An old edge name (rule 6: "edge:feature-7/side:line-4+start", one
 * feature's two faces, `a` and `b` its full face names) on the design's
 * bodies after booleans: the one edge between a face answering to each (a
 * split face's pieces all do; the tag only tells pieces apart), on any
 * body; two such edges are never guessed between. The order an old name
 * between two sides held ("A>B", its corner) adds nothing here: the
 * boolean's bodies have straight sides only (curved faces are refused
 * until 37 and 38a), and two straight sides meet in one line.
 */
export function resolveOldEdge(bodies: readonly NamedBody[], a: string, b: string): NameFound {
  const found: { body: number; index: number }[] = [];
  bodies.forEach((body, bi) =>
    body.view.edge_faces.forEach((pair, e) => {
      if (pair === null) return;
      const [x, y] = [body.faces[pair[0]]?.names ?? [], body.faces[pair[1]]?.names ?? []];
      if ((x.includes(a) && y.includes(b)) || (x.includes(b) && y.includes(a))) found.push({ body: bi, index: e });
    }),
  );
  return found.length === 1 ? { ...found[0], warning: null } : found.length > 1 ? { ambiguous: found.length } : { lost: true };
}
