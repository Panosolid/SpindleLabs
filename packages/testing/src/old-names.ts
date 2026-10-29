// Step 34a4: old names (rule 6 of docs/document-model.md, section 8). Every
// name written up to now names things inside one feature: a face
// "face:feature-7/side:line-4", an edge by two of that feature's faces
// ("edge:feature-7/side:line-4+start" as a reference, or the part after
// "<feature>/" in a projection or a pin), a vertex by its edges joined with
// "&". After booleans a body's faces come from many features, so the edge
// a name meant is found by its two faces' full names instead, as rule 5
// names every new edge: the reader turns each old name into those two
// names (`EdgeQuery`), and keeps what the old name said about which of the
// edges between them it meant, which is the fallback rule 5 already has
// for edges its names can't tell apart:
//
// - a reference's set name "A+B" (naming.ts wrote one for every pair but
//   two sides of one outline): the edge between A and B that is not
//   between two sides, `pair`;
// - an ordered name "A>B" (two sides, naming.ts): the 27b corner whose
//   first side going round is A, `ordered`;
// - a projection's or pin's "A+B" (face-edges.ts `partName`, which writes
//   it where no corner is known): the edge between A and B with no corner
//   known, `unordered`;
// - a corner name "A@end+B@start" (27b): the edge whose ends of the two
//   sides' curves are those, `corner`;
// - a vertex: every edge meeting there, each read as above; a vertex name
//   from 0.26 (no "@" anywhere) also finds a vertex whose edges are those
//   pairs whatever their corners, `any`, as `pinNow` reads them.
//
// A query finds the one edge that fits; two that fit are never guessed
// between (the 25a4 rule), and an old name whose two faces now meet twice
// says ambiguous unless what it held tells the edges apart. Nothing here
// is Design's code: `newNames` names a body Design built by rule 5 from the
// kernel's view and the faces' names only, so journeys/old-names.journey.ts
// can check, on every saved file the repo holds, that each old name finds
// by its faces what Design finds by its old string. Design reads names this
// way from 35e.

import type { BodyView } from "@fission/core";
import { nameEdges, type BooleanRebuild } from "./boolean-naming-model.ts";

/** Which of the edges between two faces an old name meant (see above). */
export type EdgeNeed = "pair" | "ordered" | "unordered" | "corner" | "any";

/** An old edge name in the new form: rule 5's two faces, and what tells the edges between them apart. */
export interface EdgeQuery {
  /** Rule 5's name of the edge when its faces meet once: "edge:<A>+<B>", the full face names sorted. */
  name: string;
  faces: readonly [string, string];
  need: EdgeNeed;
  /** `ordered`: the two sides, the one before the corner going round first. */
  order?: readonly [string, string];
  /** `corner`: "<A>@end,<B>@start", sorted. */
  corner?: string;
}

/** An old vertex name in the new form: the edges meeting there; `old26` when 0.26 could have written it (no corner in it). */
export interface VertexQuery {
  edges: readonly EdgeQuery[];
  old26: boolean;
}

/** Misreadings planted one at a time, each caught by test/old-names.test.ts and the journey. */
export type OldNameFault =
  /** The two faces kept in the order written, not sorted. */
  | "unsorted"
  /** An edge's faces read without their feature ("face:side:line-4"). */
  | "no-feature"
  /** Of two edges (or vertices) an old name fits, the first is taken. */
  | "guess"
  /** An ordered name read as a set: its order thrown away. */
  | "order-ignored"
  /** A corner name read without its ends. */
  | "corner-ignored"
  /** A vertex found by some of its edges, not all. */
  | "vertex-subset";

export const OLD_NAME_FAULTS: readonly OldNameFault[] = ["unsorted", "no-feature", "guess", "order-ignored", "corner-ignored", "vertex-subset"];

// A face's part as naming.ts writes it: a role, then for a side ":" and its
// curve id, written with encodeURIComponent, which leaves none of
// ": / + > @ & , ; #" in it.
const PART = "[a-z]+(?::[^:/+>@&,;#]+)?";
const FEATURE = /^[^:/+>@&,;#]+$/;
const ENDS = new RegExp(`^(${PART})@(start|end)\\+(${PART})@(start|end)$`);
const ORDERED = new RegExp(`^(${PART})>(${PART})$`);
const SET = new RegExp(`^(${PART})\\+(${PART})$`);

/** The query for faces `a` and `b`, sorted (left as written with "unsorted"). */
function query(a: string, b: string, need: EdgeNeed, fs: ReadonlySet<OldNameFault>, extra: Pick<EdgeQuery, "order" | "corner"> = {}): EdgeQuery {
  const faces: [string, string] = a <= b || fs.has("unsorted") ? [a, b] : [b, a];
  return { name: `edge:${faces[0]}+${faces[1]}`, faces, need, ...extra };
}

/** Face `part` of `feature` by its full name. */
const full = (feature: string, part: string, fs: ReadonlySet<OldNameFault>) => (fs.has("no-feature") ? `face:${part}` : `face:${feature}/${part}`);

/**
 * An old edge part (the name after "<feature>/") read into the new form;
 * `from` says who wrote it: a reference (naming.ts, "A+B" or "A>B") or a
 * projection or pin (`partName`, "A+B", "A>B" or "A@x+B@y"). Null for
 * anything else.
 */
export function readOldEdge(feature: string, part: string, from: "reference" | "part", faults: Iterable<OldNameFault> = []): EdgeQuery | null {
  const fs = new Set(faults);
  if (!FEATURE.test(feature)) return null;
  const f = (p: string) => full(feature, p, fs);
  let m = ENDS.exec(part);
  if (m && from === "part") {
    if (fs.has("corner-ignored")) return query(f(m[1]), f(m[3]), "any", fs);
    const corner = [`${f(m[1])}@${m[2]}`, `${f(m[3])}@${m[4]}`].sort().join(",");
    return query(f(m[1]), f(m[3]), "corner", fs, { corner });
  }
  m = ORDERED.exec(part);
  if (m) return fs.has("order-ignored") ? query(f(m[1]), f(m[2]), "any", fs) : query(f(m[1]), f(m[2]), "ordered", fs, { order: [f(m[1]), f(m[2])] });
  m = SET.exec(part);
  if (m) return query(f(m[1]), f(m[2]), from === "reference" ? "pair" : "unordered", fs);
  return null;
}

/** An old face or edge reference id ("face:F/part", "edge:F/A+B") read into the new form; null for anything else (a body, an outline, a new-form name). */
export function readOldReference(id: string, faults: Iterable<OldNameFault> = []): { face: string } | { edge: EdgeQuery } | null {
  const m = /^(face|edge):([^:/]+)\/(.+)$/.exec(id);
  if (!m) return null;
  if (m[1] === "face") return FEATURE.test(m[2]) && new RegExp(`^${PART}$`).test(m[3]) ? { face: id } : null;
  const edge = readOldEdge(m[2], m[3], "reference", faults);
  return edge === null ? null : { edge };
}

/** An old vertex name (a pin's on an end: its edges' parts joined by "&") read into the new form; null when any part isn't an old edge part. */
export function readOldVertex(feature: string, name: string, faults: Iterable<OldNameFault> = []): VertexQuery | null {
  const parts = name.split("&");
  const edges = parts.map((p) => readOldEdge(feature, p, "part", faults));
  if (edges.some((e) => e === null)) return null;
  return { edges: edges as EdgeQuery[], old26: !name.includes("@") };
}

// New names on a body Design built ---------------------------------------------

/** An edge of a body in the new form: its two faces' full names (sorted), the kernel's order between two sides, its 27b corner, rule 5's name. */
export interface NewEdge {
  faces: readonly [string, string] | null;
  /** Both faces are sides of one outline: only then is the order a corner's. */
  sides: boolean;
  /** Its faces in the kernel's order (the side before the corner first, for two sides). */
  order: readonly [string, string] | null;
  corner: string | null;
  /** Rule 5's name, or for two sides still tied, `;corner:` and its corner; null when shared. */
  name: string | null;
}

export interface NewBody {
  /** Each face's full name; null when it has none or would share it. */
  faces: (string | null)[];
  /** Full names two or more faces would have had (never guessed between). */
  sharedFaces: ReadonlySet<string>;
  edges: NewEdge[];
  /** Each vertex's edges (a whole circle's seam vertex has its one edge once). */
  vertices: number[][];
}

/**
 * A body named by rule 5 from the kernel's view and its faces' names
 * (Design's `BodyNames.faces`, `.shared.faces` and 27b's `.ends`, the
 * parts after "face:<feature>/"), not from Design's edge names: so the
 * journey's comparison has two ways of finding each edge.
 */
export function newNames(
  feature: string,
  names: { faces: readonly (string | null)[]; shared: { faces: ReadonlyMap<string, number> }; ends?: readonly (string | null)[] },
  view: Pick<BodyView, "face_roles" | "edge_faces" | "edge_vertices" | "vertex_points">,
): NewBody {
  const faces = names.faces.map((p) => (p === null ? null : `face:${feature}/${p}`));
  const sharedFaces = new Set([...names.shared.faces].filter(([, n]) => n > 1).map(([p]) => `face:${feature}/${p}`));
  const vertices: number[][] = view.vertex_points.map(() => []);
  view.edge_vertices.forEach(([a, b], e) => {
    for (const v of a === b ? [a] : [a, b]) vertices[v].push(e);
  });
  const isSide = (f: number) => view.face_roles[f]?.role === "side" && view.face_roles[f]?.piece !== undefined;
  const pairOf = (e: number): [string, string] | null => {
    const p = view.edge_faces[e];
    const [a, b] = p === null ? [null, null] : [faces[p[0]] ?? null, faces[p[1]] ?? null];
    return a === null || b === null ? null : [a, b];
  };
  // Rule 5: the two faces sorted; the other faces at its two ends, for pairs that meet twice.
  const raw = view.edge_faces.map((_, e) => {
    const pair = pairOf(e);
    if (pair === null) return null;
    const ends = new Set<string>();
    for (const v of view.edge_vertices[e])
      for (const o of vertices[v])
        for (const f of view.edge_faces[o] ?? []) {
          const n = faces[f];
          if (n !== null && n !== pair[0] && n !== pair[1]) ends.add(n);
        }
    return { faces: [...pair].sort() as [string, string], ends: [...ends].sort() };
  });
  const named = nameEdges(raw.filter((r) => r !== null));
  let k = 0;
  const edges: NewEdge[] = raw.map((r, e) => {
    const p = view.edge_faces[e];
    const sides = p !== null && isSide(p[0]) && isSide(p[1]);
    const corner = names.ends?.[e] ?? null;
    return {
      faces: r?.faces ?? null,
      sides,
      order: pairOf(e),
      corner: corner === null ? null : corner.split("+").map((c) => `face:${feature}/${c}`).join(","),
      name: r === null ? null : named[k++],
    };
  });
  // Still tied (a half disc's two uprights): two sides fall back on their corners.
  const tied = edges.filter((e) => e.faces !== null && e.name === null && e.sides && e.corner !== null);
  for (const e of tied) {
    const n = `edge:${e.faces![0]}+${e.faces![1]};corner:${e.corner}`;
    if (tied.filter((o) => o.faces!.join() === e.faces!.join() && o.corner === e.corner).length === 1) e.name = n;
  }
  return { faces, sharedFaces, edges, vertices };
}

/** What a name finds: one face, edge or vertex by kernel index; two or more, never guessed between; or none. */
export type Found = { index: number } | "ambiguous" | "lost";

/** A face by its full name. */
export function findFace(body: NewBody, name: string): Found {
  const i = body.faces.indexOf(name);
  return i >= 0 ? { index: i } : body.sharedFaces.has(name) ? "ambiguous" : "lost";
}

/** Whether edge `e` is one an old name asked for. */
function fits(e: NewEdge, q: EdgeQuery): boolean {
  if (e.faces === null || e.faces[0] !== q.faces[0] || e.faces[1] !== q.faces[1]) return false;
  switch (q.need) {
    case "pair":
      return !e.sides;
    case "ordered":
      return e.sides && e.order![0] === q.order![0] && e.order![1] === q.order![1];
    case "unordered":
      return e.corner === null;
    case "corner":
      return e.corner === q.corner;
    case "any":
      return true;
  }
}

/** The edges an old name asks for, by kernel index (its faces' sharing aside). */
const fitting = (body: NewBody, q: EdgeQuery) => body.edges.flatMap((e, i) => (fits(e, q) ? [i] : []));

/** An old edge name read into the new form, on a body: the one edge that fits; ambiguous when two do, or a face it names is shared, or (unordered) its faces meet twice with no corner known. */
export function findEdge(body: NewBody, q: EdgeQuery, faults: Iterable<OldNameFault> = []): Found {
  const fs = new Set(faults);
  const found = fitting(body, q);
  if (found.length === 1 || (found.length > 1 && fs.has("guess"))) return { index: found[0] };
  if (found.length > 1 || body.sharedFaces.has(q.faces[0]) || body.sharedFaces.has(q.faces[1])) return "ambiguous";
  return "lost";
}

/**
 * An old vertex name, on a body: the one vertex whose edges are exactly
 * the edges it names, each fitting its query; for a 0.26 name none fits,
 * then the one whose edges are those pairs whatever their corners.
 * Ambiguous when two vertices fit, or a face it names is shared.
 */
export function findVertex(body: NewBody, q: VertexQuery, faults: Iterable<OldNameFault> = []): Found {
  const fs = new Set(faults);
  const match = (need?: EdgeNeed) =>
    body.vertices.flatMap((edges, v) => {
      const qs = need === undefined ? q.edges : q.edges.map((e) => ({ ...e, need }));
      if (!fs.has("vertex-subset") && edges.length !== qs.length) return [];
      // Each query takes a different edge of the vertex: try them in turn (a vertex has few edges).
      const used = new Set<number>();
      const take = (k: number): boolean => {
        if (k === qs.length) return true;
        for (const e of edges)
          if (!used.has(e) && fits(body.edges[e], qs[k])) {
            used.add(e);
            if (take(k + 1)) return true;
            used.delete(e);
          }
        return false;
      };
      return take(0) ? [v] : [];
    });
  let found = match();
  if (found.length === 0 && q.old26) found = match("any");
  if (found.length === 1 || (found.length > 1 && fs.has("guess"))) return { index: found[0] };
  if (found.length > 1 || q.edges.some((e) => body.sharedFaces.has(e.faces[0]) || body.sharedFaces.has(e.faces[1]))) return "ambiguous";
  return "lost";
}

// Old names on the boolean model's bodies -------------------------------------

/**
 * An old edge name on a result of booleans (the model, 34a2): the one edge
 * between a face answering to each of its two names (a split face's pieces
 * all do: the tag only tells pieces apart), on any body; two such edges
 * are never guessed between. The model's bodies are rectangles extruded, so
 * no corner or order is known in it, and an ordered or corner name finds
 * an edge only when its two faces meet once.
 */
export function findOldEdgeAfterBooleans(r: BooleanRebuild, q: EdgeQuery): { body: string; name: string | null } | "ambiguous" | "lost" {
  const found: { body: string; name: string | null }[] = [];
  for (const b of r.bodies) {
    const answers = (full: string, name: string) => b.faces.find((f) => f.full === full)?.names.includes(name) ?? false;
    for (const e of b.edges) {
      const [x, y] = e.faces;
      if ((answers(x, q.faces[0]) && answers(y, q.faces[1])) || (answers(x, q.faces[1]) && answers(y, q.faces[0]))) found.push({ body: b.id, name: e.name });
    }
  }
  return found.length === 1 ? found[0] : found.length > 1 ? "ambiguous" : "lost";
}
