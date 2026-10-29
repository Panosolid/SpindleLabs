// The exact model of names through joins, cuts and Combine (step 34a2), the
// oracle for Design's names once booleans land (35e, 35f, 39). The rules are
// docs/document-model.md, section 8; each is cited here by its number there.
//
// Its world is blocks: a rectangle sketched on XY (corners in mm) extruded
// from one height to another, as a new body, or joined to or cut from the
// bodies it lists (an Extrude with its participants, fixed when it is made,
// Fusion check F4), and Combine (a target body, tool bodies in the order
// picked, join, cut or intersect, keep tools). A block's faces are named as
// Design names an extrude's: "face:feature-2/start" (its z0 cap, the
// sketch's side), "face:feature-2/end" (z1) and "face:feature-2/side:line-1"
// for the side swept from the rectangle's first line. The lines run
// counter-clockwise from (x0, y0): line 1 along y = y0, 2 along x = x1, 3
// along y = y1, 4 along x = x0, so Ben's bar (F1) has its far end, x = 100,
// on line 2.
//
// Every body is a set of cells of one grid, the grid of every coordinate any
// block uses (with an empty layer all round), so every solid every feature
// can make is exactly a union of cells: no tolerance, no rounding, every
// yes-or-no question answered by looking at cells. Each face of a cell that
// borders an empty cell is a patch, and a patch carries the names of the
// input faces it lies on. A face is a connected set of patches facing the
// same way in one plane (decision 6: coplanar faces that touch are one face),
// answering to the names its patches carry (rule 4). Areas and volumes are
// sums of products of grid steps, exact for whole-mm parts.
//
// A result is checked for touching only along an edge or at a corner the
// standard way for cells: around every grid point, the filled cells of the
// eight must be connected through their faces, and so must the empty ones;
// either split is an edge or a corner where the surface pinches.
//
// `faults` plants the bugs the tests use to prove each check can fail; real
// code never passes any.

const esc = encodeURIComponent;

/** A rectangle on XY by two opposite corners, x0 < x1 and y0 < y1, in mm. */
export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

/** An extrude of a rectangle on XY from z0 to z1 (an Extrude with a rectangle sketch). */
export interface BlockFeature {
  kind: "block";
  id: string;
  rect: Rect;
  z: readonly [z0: number, z1: number];
  operation: "new" | "join" | "cut";
  /** Join and cut: the bodies it works on, by id, fixed when it was made. */
  bodies?: readonly string[];
  /** The rectangle's four line ids, from line 1; "line-1" … "line-4" when left out. */
  lines?: readonly [string, string, string, string];
}

export interface CombineFeature {
  kind: "combine";
  id: string;
  target: string;
  tools: readonly string[];
  operation: "join" | "cut" | "intersect";
  keepTools?: boolean;
}

export type BooleanFeature = BlockFeature | CombineFeature;

/** The way a face faces. */
export type Facing = "-x" | "+x" | "-y" | "+y" | "-z" | "+z";
const FACINGS: readonly Facing[] = ["-x", "+x", "-y", "+y", "-z", "+z"];

export interface BooleanFace {
  /** Every name it answers to, the one shown first (rule 4). */
  names: readonly string[];
  facing: Facing;
  /** Where its plane is along its facing's axis. */
  at: number;
  area: number;
  /** Its lowest corner: smallest x, then y, then z. */
  low: readonly [number, number, number];
}

export interface BooleanBody {
  id: string;
  volume: number;
  /** Its lowest corner, as a face's. */
  low: readonly [number, number, number];
  /** In made order of their shown names, ties by lowest corner. */
  faces: readonly BooleanFace[];
}

export interface BooleanRebuild {
  /** In made order (rule 1's "earliest-made"). */
  bodies: readonly BooleanBody[];
  /** Each feature that failed, with why in words; its bodies stay as they were. */
  failed: ReadonlyMap<string, string>;
}

/**
 * The bugs `faults` plants, one per rule (section 8 of
 * docs/document-model.md), each caught by test/boolean-naming-model.test.ts.
 */
export type BooleanFault =
  | "keep-largest" // rule 1: the largest piece keeps the id, not the first face's
  | "keep-first-reached" // rule 1: the first face reaching a piece decides, whole or not
  | "number-by-volume" // rule 1: other pieces numbered by volume alone
  | "number-per-body" // rule 1: piece numbers start again for every body cut
  | "join-latest" // rule 1: an Extrude join keeps the latest-made body's id
  | "tool-keeps-id" // rule 1 (F2): a Combine join's apart tool keeps its own id
  | "wall-target-name" // rule 2: a cut's wall named after the target face it is in
  | "merge-tool-first" // rule 4: a merged face shows the tool's name first
  | "merge-one-name" // rule 4: a merged face keeps only its shown name
  | "empty-allowed" // F3: a cut leaving nothing makes the body vanish
  | "pinch-allowed"; // decision 2: an edge or corner touch is not refused

export const BOOLEAN_FAULTS: readonly BooleanFault[] = [
  "keep-largest",
  "keep-first-reached",
  "number-by-volume",
  "number-per-body",
  "join-latest",
  "tool-keeps-id",
  "wall-target-name",
  "merge-tool-first",
  "merge-one-name",
  "empty-allowed",
  "pinch-allowed",
];

export const faceName = (feature: string, role: string): string => `face:${esc(feature)}/${role}`;
export const bodyName = (feature: string, piece?: number): string => `body:${esc(feature)}${piece === undefined ? "" : `/piece:${piece}`}`;
export const blockFaceName = (f: BlockFeature, role: "start" | "end" | 1 | 2 | 3 | 4): string =>
  faceName(f.id, typeof role === "string" ? role : `side:${esc(linesOf(f)[role - 1])}`);

function linesOf(f: BlockFeature): readonly string[] {
  return f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
}

// The grid ------------------------------------------------------------------

interface Grid {
  xs: number[];
  ys: number[];
  zs: number[];
  nx: number;
  ny: number;
  nz: number;
}

function axisOf(values: number[]): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  // An empty layer all round, so no filled cell is ever on the grid's edge.
  return sorted.length === 0 ? [0, 1] : [sorted[0] - 1, ...sorted, sorted[sorted.length - 1] + 1];
}

function gridOf(features: readonly BooleanFeature[]): Grid {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const f of features) {
    if (f.kind !== "block" || !blockValid(f)) continue;
    xs.push(f.rect[0], f.rect[2]);
    ys.push(f.rect[1], f.rect[3]);
    zs.push(f.z[0], f.z[1]);
  }
  const g = { xs: axisOf(xs), ys: axisOf(ys), zs: axisOf(zs) };
  return { ...g, nx: g.xs.length - 1, ny: g.ys.length - 1, nz: g.zs.length - 1 };
}

function blockValid(f: BlockFeature): boolean {
  const [x0, y0, x1, y1] = f.rect;
  const n = [x0, y0, x1, y1, f.z[0], f.z[1]];
  return n.every(Number.isFinite) && x0 < x1 && y0 < y1 && f.z[0] < f.z[1] && new Set(linesOf(f)).size === 4;
}

const cellAt = (g: Grid, i: number, j: number, k: number) => i + g.nx * (j + g.ny * k);
function ijk(g: Grid, c: number): [number, number, number] {
  return [c % g.nx, Math.floor(c / g.nx) % g.ny, Math.floor(c / (g.nx * g.ny))];
}

/** The cell next to `c` across its face `d` (an index into FACINGS); −1 off the grid. */
function across(g: Grid, c: number, d: number): number {
  const p = ijk(g, c);
  const axis = d >> 1;
  p[axis] += d & 1 ? 1 : -1;
  const n = [g.nx, g.ny, g.nz][axis];
  return p[axis] < 0 || p[axis] >= n ? -1 : cellAt(g, p[0], p[1], p[2]);
}

function cellSize(g: Grid, c: number): [number, number, number] {
  const [i, j, k] = ijk(g, c);
  return [g.xs[i + 1] - g.xs[i], g.ys[j + 1] - g.ys[j], g.zs[k + 1] - g.zs[k]];
}

function cellLow(g: Grid, c: number): [number, number, number] {
  const [i, j, k] = ijk(g, c);
  return [g.xs[i], g.ys[j], g.zs[k]];
}

function patchArea(g: Grid, c: number, d: number): number {
  const s = cellSize(g, c);
  const axis = d >> 1;
  return s[(axis + 1) % 3] * s[(axis + 2) % 3];
}

/** The patch's lowest corner: the cell's, moved to the far side for a + facing. */
function patchLow(g: Grid, c: number, d: number): [number, number, number] {
  const low = cellLow(g, c);
  if (d & 1) low[d >> 1] += cellSize(g, c)[d >> 1];
  return low;
}

const lexLess = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};
const lexCompare = (a: readonly number[], b: readonly number[]) => (lexLess(a, b) ? -1 : lexLess(b, a) ? 1 : 0);

// Solids with named patches -------------------------------------------------

/** A solid: which cells are filled, and each boundary patch's names (key cell × 6 + facing). */
interface Solid {
  cells: Uint8Array;
  names: Map<number, readonly string[]>;
}

const key = (c: number, d: number) => c * 6 + d;
const opposite = (d: number) => d ^ 1;

function blockSolid(g: Grid, f: BlockFeature): Solid {
  const cells = new Uint8Array(g.nx * g.ny * g.nz);
  const [x0, y0, x1, y1] = f.rect;
  const inside = (lo: number, hi: number, a: number, b: number) => a >= lo && b <= hi;
  for (let c = 0; c < cells.length; c++) {
    const [i, j, k] = ijk(g, c);
    if (inside(x0, x1, g.xs[i], g.xs[i + 1]) && inside(y0, y1, g.ys[j], g.ys[j + 1]) && inside(f.z[0], f.z[1], g.zs[k], g.zs[k + 1])) cells[c] = 1;
  }
  // -x is line 4, +x line 2, -y line 1, +y line 3, -z the start cap, +z the end cap.
  const role: Record<number, "start" | "end" | 1 | 2 | 3 | 4> = { 0: 4, 1: 2, 2: 1, 3: 3, 4: "start", 5: "end" };
  const names = new Map<number, readonly string[]>();
  eachPatch(g, cells, (c, d) => names.set(key(c, d), [blockFaceName(f, role[d])]));
  return { cells, names };
}

function eachPatch(g: Grid, cells: Uint8Array, visit: (c: number, d: number) => void): void {
  for (let c = 0; c < cells.length; c++) {
    if (!cells[c]) continue;
    for (let d = 0; d < 6; d++) {
      const n = across(g, c, d);
      if (n < 0 || !cells[n]) visit(c, d);
    }
  }
}

type Op = "join" | "cut" | "intersect";

/**
 * `a` op `b`, each patch named after the input face it lies on (rule 2):
 * where both inputs have a face (coincident faces of a join or an
 * intersect), both names, `a`'s first (rule 4).
 */
function combine(g: Grid, a: Solid, b: Solid, op: Op, faults: ReadonlySet<BooleanFault>): Solid {
  const cells = new Uint8Array(a.cells.length);
  for (let c = 0; c < cells.length; c++) {
    const [x, y] = [a.cells[c], b.cells[c]];
    cells[c] = op === "join" ? x | y : op === "cut" ? x & (1 - y) : x & y;
  }
  const names = new Map<number, readonly string[]>();
  eachPatch(g, cells, (c, d) => {
    const n = across(g, c, d);
    const inA = (x: number) => x >= 0 && a.cells[x] === 1;
    const inB = (x: number) => x >= 0 && b.cells[x] === 1;
    const got: string[] = [];
    if (op === "cut") {
      // c is in a and not in b; its neighbour is out of a, or in b (the tool's wall).
      if (!inA(n)) got.push(...a.names.get(key(c, d))!);
      else if (faults.has("wall-target-name")) got.push(...a.names.values().next().value!);
      else got.push(...b.names.get(key(n, opposite(d)))!);
    } else {
      if (inA(c) && !inA(n)) got.push(...a.names.get(key(c, d))!);
      if (inB(c) && !inB(n)) got.push(...b.names.get(key(c, d))!);
    }
    names.set(key(c, d), [...new Set(got)]);
  });
  return { cells, names };
}

// Faces ---------------------------------------------------------------------

/** Where a name comes first in made order: its feature's place in the timeline, then the feature's own order. */
type Made = (name: string) => readonly number[];

interface Face {
  names: string[];
  d: number;
  patches: number[];
  area: number;
  low: [number, number, number];
}

/**
 * A solid's faces. A face's names are every name its patches carry, ranked
 * by `rank` (the body each came from: the target's before the tools', rule
 * 4), then by its place in the patches' lists (so a face merged earlier
 * keeps the name it showed), then by the rest of `rank` (made order).
 */
function facesOf(g: Grid, s: Solid, rank: Made, faults: ReadonlySet<BooleanFault>): Face[] {
  const seen = new Set<number>();
  const faces: Face[] = [];
  eachPatch(g, s.cells, (c0, d) => {
    if (seen.has(key(c0, d))) return;
    const patches: number[] = [];
    const todo = [c0];
    seen.add(key(c0, d));
    while (todo.length > 0) {
      const c = todo.pop()!;
      patches.push(c);
      for (let e = 0; e < 6; e++) {
        if (e >> 1 === d >> 1) continue;
        const n = across(g, c, e);
        if (n < 0 || !s.cells[n] || seen.has(key(n, d))) continue;
        const beyond = across(g, n, d);
        if (beyond >= 0 && s.cells[beyond]) continue;
        seen.add(key(n, d));
        todo.push(n);
      }
    }
    const place = new Map<string, number>();
    for (const c of patches)
      s.names.get(key(c, d))!.forEach((n, i) => {
        if (i < (place.get(n) ?? Infinity)) place.set(n, i);
      });
    const sortKey = (n: string) => {
      const r = rank(n);
      return [r[0], place.get(n)!, ...r.slice(1)];
    };
    let names = [...place.keys()].sort((x, y) => lexCompare(sortKey(x), sortKey(y)));
    if (faults.has("merge-tool-first")) names.reverse();
    if (faults.has("merge-one-name")) names = names.slice(0, 1);
    let low = patchLow(g, patches[0], d);
    let area = 0;
    for (const c of patches) {
      area += patchArea(g, c, d);
      const l = patchLow(g, c, d);
      if (lexLess(l, low)) low = l;
    }
    faces.push({ names, d, patches: patches.sort((x, y) => x - y), area, low });
  });
  return faces;
}

/** The solid with every patch renamed to its face's names, so the next feature sees whole faces. */
function settled(g: Grid, s: Solid, rank: Made, faults: ReadonlySet<BooleanFault>): Solid {
  const names = new Map<number, readonly string[]>();
  for (const f of facesOf(g, s, rank, faults)) for (const c of f.patches) names.set(key(c, f.d), f.names);
  return { cells: s.cells, names };
}

// Pieces --------------------------------------------------------------------

/** The solid's connected pieces (cells joined through their faces), each its cells' piece number; −1 empty. */
function piecesOf(g: Grid, cells: Uint8Array): { of: Int32Array; count: number } {
  const of = new Int32Array(cells.length).fill(-1);
  let count = 0;
  for (let c0 = 0; c0 < cells.length; c0++) {
    if (!cells[c0] || of[c0] >= 0) continue;
    const todo = [c0];
    of[c0] = count;
    while (todo.length > 0) {
      const c = todo.pop()!;
      for (let d = 0; d < 6; d++) {
        const n = across(g, c, d);
        if (n >= 0 && cells[n] && of[n] < 0) {
          of[n] = count;
          todo.push(n);
        }
      }
    }
    count++;
  }
  return { of, count };
}

/**
 * Whether the solid pinches anywhere: around some grid point, its filled
 * cells (or its empty ones) among the eight are not connected through
 * their faces. An edge touch splits the four round that edge two and two,
 * which shows at every grid point along it; a corner touch at that point.
 */
function pinched(g: Grid, cells: Uint8Array): boolean {
  for (let k = 1; k < g.nz; k++)
    for (let j = 1; j < g.ny; j++)
      for (let i = 1; i < g.nx; i++) {
        let mask = 0;
        for (let b = 0; b < 8; b++) if (cells[cellAt(g, i - 1 + (b & 1), j - 1 + ((b >> 1) & 1), k - 1 + (b >> 2))]) mask |= 1 << b;
        if (!connected8(mask) || !connected8(~mask & 255)) return true;
      }
  return false;
}

/** Whether the cells of `mask` among a 2 × 2 × 2 block (bit b = x + 2y + 4z) are connected through faces; none is. */
function connected8(mask: number): boolean {
  if (mask === 0) return true;
  let reached = mask & -mask;
  for (;;) {
    let next = reached;
    for (let b = 0; b < 8; b++) if (reached & (1 << b)) for (const s of [1, 2, 4]) next |= (1 << (b ^ s)) & mask;
    if (next === reached) return reached === mask;
    reached = next;
  }
}

function volumeOf(g: Grid, cells: Uint8Array): number {
  let v = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c]) v += cellSize(g, c).reduce((p, x) => p * x, 1);
  return v;
}

function lowOf(g: Grid, cells: Uint8Array): [number, number, number] {
  let low: [number, number, number] | null = null;
  for (let c = 0; c < cells.length; c++) {
    if (!cells[c]) continue;
    const l = cellLow(g, c);
    if (low === null || lexLess(l, low)) low = l;
  }
  return low ?? [0, 0, 0];
}

/**
 * Rule 1: which piece of `after` keeps the id of `before`, and the order of
 * the rest. Walk `before`'s faces in made order (ties by lowest corner);
 * the first face whose surviving part (its patches still on the surface
 * under its shown name) is not empty and lies in one piece names the
 * keeper. Every piece is ranked by the first face reaching it, its share
 * of that face, its volume (larger first) and its lowest corner; with no
 * face wholly in one piece the first by rank keeps the id.
 */
function ranked(g: Grid, beforeFaces: readonly Face[], after: Solid, pieces: { of: Int32Array; count: number }, made: Made, faults: ReadonlySet<BooleanFault>): { keeper: number; order: number[] } {
  const walk = [...beforeFaces].sort((x, y) => lexCompare(made(x.names[0]), made(y.names[0])) || lexCompare(x.low, y.low));
  const first = new Array<number>(pieces.count).fill(Infinity);
  const share = new Array<number>(pieces.count).fill(0);
  let keeper = -1;
  walk.forEach((f, w) => {
    const reach = new Map<number, number>();
    for (const c of f.patches) {
      const kept = after.names.get(key(c, f.d));
      if (kept === undefined || !kept.includes(f.names[0])) continue;
      const p = pieces.of[c];
      reach.set(p, (reach.get(p) ?? 0) + patchArea(g, c, f.d));
    }
    for (const [p, area] of reach)
      if (first[p] === Infinity) {
        first[p] = w;
        share[p] = area;
      }
    if (keeper < 0 && (reach.size === 1 || (faults.has("keep-first-reached") && reach.size > 0))) keeper = [...reach.keys()][0];
  });
  const volume: number[] = [];
  const low: [number, number, number][] = [];
  for (let p = 0; p < pieces.count; p++) {
    const cells = after.cells.map((x, c) => (x && pieces.of[c] === p ? 1 : 0));
    volume.push(volumeOf(g, cells));
    low.push(lowOf(g, cells));
  }
  const order = [...Array(pieces.count).keys()].sort((p, q) =>
    faults.has("number-by-volume") ? volume[q] - volume[p] || lexCompare(low[p], low[q]) : first[p] - first[q] || share[q] - share[p] || volume[q] - volume[p] || lexCompare(low[p], low[q]),
  );
  if (keeper < 0) keeper = order[0];
  if (faults.has("keep-largest")) keeper = [...order].sort((p, q) => volume[q] - volume[p] || p - q)[0];
  return { keeper, order: order.filter((p) => p !== keeper) };
}

function pieceSolid(after: Solid, pieces: { of: Int32Array }, p: number): Solid {
  const cells = after.cells.map((x, c) => (x && pieces.of[c] === p ? 1 : 0));
  const names = new Map<number, readonly string[]>();
  for (const [k, n] of after.names) if (pieces.of[Math.floor(k / 6)] === p) names.set(k, n);
  return { cells, names };
}

// Rebuild -------------------------------------------------------------------

/** For reading faces already settled: each keeps its names' order. Faults are planted only where a feature settles its result. */
const KEEP_ORDER: Made = () => [0];
const NONE: ReadonlySet<BooleanFault> = new Set();

interface Body {
  id: string;
  solid: Solid;
}

class Failed extends Error {}

/**
 * Every feature in order, as section 8 of docs/document-model.md says: the
 * bodies left at the end, and the features that failed (bodies kept).
 */
export function rebuildBooleans(features: readonly BooleanFeature[], faults: Iterable<BooleanFault> = []): BooleanRebuild {
  const fs = new Set(faults);
  const g = gridOf(features);
  const place = new Map<string, number>();
  features.forEach((f, i) => place.set(esc(f.id), i));
  // Made order of a face name: its feature's place, then start, end, the sides by line.
  const roleOrder = new Map<string, number>();
  for (const f of features)
    if (f.kind === "block") {
      roleOrder.set(blockFaceName(f, "start"), 0);
      roleOrder.set(blockFaceName(f, "end"), 1);
      for (const s of [1, 2, 3, 4] as const) roleOrder.set(blockFaceName(f, s), 1 + s);
    }
  const made: Made = (name) => {
    const feature = name.slice("face:".length, name.indexOf("/"));
    return [place.get(feature) ?? Infinity, roleOrder.get(name) ?? Infinity];
  };
  const bodyMade = (id: string): number[] => {
    const m = /^body:([^/]*)(?:\/piece:(\d+))?$/.exec(id)!;
    return [place.get(m[1]) ?? Infinity, m[2] === undefined ? 0 : Number(m[2])];
  };

  let bodies: Body[] = [];
  const failed = new Map<string, string>();
  const find = (id: string) => {
    const b = bodies.find((x) => x.id === id);
    if (b === undefined) throw new Failed(`no body ${id}`);
    return b;
  };
  /** The rank for a merged face's lists: the body each name was on, in `order`, then made order. */
  const rankBy = (order: readonly Solid[]): Made => {
    const from = new Map<string, number>();
    order.forEach((s, i) => {
      for (const l of s.names.values()) for (const n of l) if (!from.has(n)) from.set(n, i);
    });
    return (name) => [from.get(name) ?? order.length, ...made(name)];
  };
  const refusePinch = (s: Solid) => {
    if (!fs.has("pinch-allowed") && pinched(g, s.cells)) throw new Failed("the result would touch itself only along an edge or at a corner");
  };

  for (const f of features) {
    try {
      if (f.kind === "block") {
        if (!blockValid(f)) throw new Failed("the rectangle or the heights are not valid");
        const block = blockSolid(g, f);
        if (f.operation === "new") {
          bodies = [...bodies, { id: bodyName(f.id), solid: block }];
          continue;
        }
        const listed = [...new Set(f.bodies ?? [])].map(find);
        if (f.operation === "join") {
          // Rule 1: each piece takes the earliest-made body in it; one holding only the block is the block's own.
          const inputs = [...listed].sort((a, b) => lexCompare(bodyMade(a.id), bodyMade(b.id)));
          const order = [...inputs.map((b) => b.solid), block];
          const raw = order.slice(1).reduce((acc, s) => combine(g, acc, s, "join", fs), order[0]);
          refusePinch(raw);
          const after = settled(g, raw, rankBy(order), fs);
          const pieces = piecesOf(g, after.cells);
          const out: Body[] = [];
          for (let p = 0; p < pieces.count; p++) {
            const holds = inputs.filter((b) => b.solid.cells.some((x, c) => x === 1 && pieces.of[c] === p));
            const pick = fs.has("join-latest") ? holds[holds.length - 1] : holds[0];
            out.push({ id: pick?.id ?? bodyName(f.id), solid: pieceSolid(after, pieces, p) });
          }
          bodies = [...bodies.filter((b) => !listed.includes(b)), ...out];
          continue;
        }
        // A cut: each listed body on its own, the pieces numbered on across them.
        let next = 1;
        const replaced = new Map<Body, Body[]>();
        for (const b of listed) {
          if (fs.has("number-per-body")) next = 1;
          const out = split(b, [block], "cut", f.id, next);
          next += out.length - 1;
          replaced.set(b, out);
        }
        bodies = bodies.flatMap((b) => replaced.get(b) ?? [b]);
        continue;
      }
      const target = find(f.target);
      const tools = f.tools.map(find);
      if (tools.length === 0) throw new Failed("no tool bodies");
      if (tools.includes(target)) throw new Failed("the target is also a tool");
      if (new Set(tools).size !== tools.length) throw new Failed("a tool is picked twice");
      const out = split(target, tools.map((t) => t.solid), f.operation, f.id, 1, f.operation === "join" && fs.has("tool-keeps-id") ? tools : undefined);
      const gone = f.keepTools ? [] : tools;
      bodies = bodies.flatMap((b) => (b === target ? out : gone.includes(b) ? [] : [b]));
    } catch (e) {
      if (!(e instanceof Failed)) throw e;
      failed.set(f.id, e.message);
    }
  }

  /** `body` op each of `tools` in turn, its pieces named by rule 1, new ones from `firstPiece` on. */
  function split(body: Body, tools: readonly Solid[], op: Op, feature: string, firstPiece: number, toolIds?: readonly Body[]): Body[] {
    const raw = tools.reduce((acc, t) => combine(g, acc, t, op, fs), body.solid);
    if (!raw.cells.includes(1)) {
      if (fs.has("empty-allowed")) return [];
      throw new Failed(`it would leave nothing of ${body.id}`);
    }
    refusePinch(raw);
    const rank = rankBy([body.solid, ...tools]);
    const after = settled(g, raw, rank, fs);
    const pieces = piecesOf(g, after.cells);
    const { keeper, order } = ranked(g, facesOf(g, body.solid, KEEP_ORDER, NONE), after, pieces, made, fs);
    const out: Body[] = [{ id: body.id, solid: pieceSolid(after, pieces, keeper) }];
    order.forEach((p, i) => {
      // The planted F2 bug: a tool's apart lump keeps the tool's own id.
      const tool = toolIds?.find((t) => t.solid.cells.some((x, c) => x === 1 && pieces.of[c] === p));
      out.push({ id: tool?.id ?? bodyName(feature, firstPiece + i), solid: pieceSolid(after, pieces, p) });
    });
    return out;
  }

  const shown = [...bodies].sort((a, b) => lexCompare(bodyMade(a.id), bodyMade(b.id)));
  return {
    bodies: shown.map((b) => ({
      id: b.id,
      volume: volumeOf(g, b.solid.cells),
      low: lowOf(g, b.solid.cells),
      faces: facesOf(g, b.solid, KEEP_ORDER, NONE)
        .sort((x, y) => lexCompare(made(x.names[0]), made(y.names[0])) || lexCompare(x.low, y.low))
        .map((x) => ({ names: x.names, facing: FACINGS[x.d], at: x.low[x.d >> 1], area: x.area, low: x.low })),
    })),
    failed,
  };
}
