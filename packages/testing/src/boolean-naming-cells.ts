// A second, independent count of names through joins, cuts and Combine
// (step 34a5), on unit cells: written from docs/document-model.md,
// section 8, not from boolean-naming-model.ts, and in a different way, so
// the seeded sessions (boolean-naming-session.ts) can hold the two against
// each other at every step. The model works on the grid of every
// coordinate the blocks use, cells of any size, numbered; this works only
// on whole millimetres, every cell one cubic millimetre, held by its
// corner as text ("x,y,z"), so small parts only. Agreement is
// self-consistency (CLAUDE.md, test quality rules): it catches the two
// disagreeing, not a mistake both make from the same misreading of the
// rules, which is what the hand-worked tests are for.
//
// Where the rules leave a choice, this takes the reading the rules' words
// give, so a disagreement is either a bug in one of the two or a gap in
// the words; each such reading is said where it is made.

import type { BooleanFeature, BlockFeature, Facing } from "./boolean-naming-model.ts";

const esc = encodeURIComponent;

/** The six ways a unit square can face, as [axis, sign]: −x, +x, −y, +y, −z, +z. */
const DIRS: readonly (readonly [number, 1 | -1])[] = [
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 1],
  [2, -1],
  [2, 1],
];
const FACING_NAMES: readonly Facing[] = ["-x", "+x", "-y", "+y", "-z", "+z"];

type P = [number, number, number];
const k3 = (p: readonly number[]) => `${p[0]},${p[1]},${p[2]}`;
const parsed = new Map<string, P>();
const p3 = (s: string): P => {
  let p = parsed.get(s);
  if (p === undefined) {
    p = s.split(",").map(Number) as P;
    parsed.set(s, p);
  }
  return [p[0], p[1], p[2]];
};
const step = (p: readonly number[], d: number): P => {
  const q = [...p] as P;
  q[DIRS[d][0]] += DIRS[d][1];
  return q;
};
/** A unit square on a cell's side: "x,y,z|d". */
const sq = (cell: string, d: number) => `${cell}|${d}`;
const unsq = (s: string): [string, number] => {
  const [c, d] = s.split("|");
  return [c, Number(d)];
};
const before = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** A solid of unit cells; each unit square of its surface carries the names of the faces it lies on, shown first. */
interface Cells {
  filled: Set<string>;
  names: Map<string, string[]>;
}

function surface(filled: ReadonlySet<string>): [string, number][] {
  const out: [string, number][] = [];
  for (const c of filled) for (let d = 0; d < 6; d++) if (!filled.has(k3(step(p3(c), d)))) out.push([c, d]);
  return out;
}

function blockCells(f: BlockFeature): Cells {
  const [x0, y0, x1, y1] = f.rect;
  const filled = new Set<string>();
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = f.z[0]; z < f.z[1]; z++) filled.add(k3([x, y, z]));
  const lines = f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
  // Line 1 runs along y = y0 (it faces −y), 2 along x = x1 (+x), 3 along y = y1 (+y), 4 along x = x0 (−x).
  const role = ["side:" + esc(lines[3]), "side:" + esc(lines[1]), "side:" + esc(lines[0]), "side:" + esc(lines[2]), "start", "end"];
  const names = new Map<string, string[]>();
  for (const [c, d] of surface(filled)) names.set(sq(c, d), [`face:${esc(f.id)}/${role[d]}`]);
  return { filled, names };
}

type Op = "join" | "cut" | "intersect";

/** `a` op `b`: which cells, and each surface square named after the input face it lies on, `a`'s names before `b`'s where both have one. */
function apply(a: Cells, b: Cells, op: Op): Cells {
  const filled = new Set<string>();
  const all = new Set([...a.filled, ...b.filled]);
  for (const c of all) {
    const [ia, ib] = [a.filled.has(c), b.filled.has(c)];
    if (op === "join" ? ia || ib : op === "cut" ? ia && !ib : ia && ib) filled.add(c);
  }
  const names = new Map<string, string[]>();
  for (const [c, d] of surface(filled)) {
    const n = k3(step(p3(c), d));
    const got: string[] = [];
    if (op === "cut") {
      // Either the neighbour was never in a (a's own face), or the tool took it (the tool's face, seen from the tool's side).
      if (a.filled.has(n)) got.push(...b.names.get(sq(n, d ^ 1))!);
      else got.push(...a.names.get(sq(c, d))!);
    } else {
      if (a.filled.has(c) && !a.filled.has(n)) got.push(...a.names.get(sq(c, d))!);
      if (b.filled.has(c) && !b.filled.has(n)) got.push(...b.names.get(sq(c, d))!);
    }
    names.set(sq(c, d), got.filter((x, i) => got.indexOf(x) === i));
  }
  return { filled, names };
}

/** A face: unit squares facing one way in one plane, joined along their sides, every one on the surface. */
interface CFace {
  d: number;
  squares: string[];
  names: string[];
  low: P;
}

/** The squares on the surface, grouped into faces, in no particular order. */
function groupFaces(s: Cells): { d: number; squares: string[] }[] {
  const left = new Set(surface(s.filled).map(([c, d]) => sq(c, d)));
  const out: { d: number; squares: string[] }[] = [];
  for (const start of [...left].sort()) {
    if (!left.has(start)) continue;
    left.delete(start);
    const d = unsq(start)[1];
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      const p = p3(unsq(group[i])[0]);
      for (let e = 0; e < 6; e++) {
        if (DIRS[e][0] === DIRS[d][0]) continue;
        const next = sq(k3(step(p, e)), d);
        if (left.has(next)) {
          left.delete(next);
          group.push(next);
        }
      }
    }
    out.push({ d, squares: group });
  }
  return out;
}

/** The lowest corner of a square: its cell's, moved one along the facing axis for a + facing. */
function squareLow(s: string): P {
  const [c, d] = unsq(s);
  const p = p3(c);
  if (DIRS[d][1] === 1) p[DIRS[d][0]] += 1;
  return p;
}

const lowest = (ps: readonly P[]): P => ps.reduce((m, p) => (before(p, m) < 0 ? p : m));

/** Is there an edge or a corner where only edges or corners touch? Around each lattice point, the filled cells of the eight, and the empty ones, must each be one group through shared sides. */
function pinches(filled: ReadonlySet<string>, counts: (around: readonly string[]) => boolean = () => true): boolean {
  const points = new Set<string>();
  for (const c of filled) {
    const p = p3(c);
    for (let b = 0; b < 8; b++) points.add(k3([p[0] + (b & 1), p[1] + ((b >> 1) & 1), p[2] + (b >> 2)]));
  }
  for (const pt of points) {
    const p = p3(pt);
    const cells = [...Array(8).keys()].map((b) => k3([p[0] - 1 + (b & 1), p[1] - 1 + ((b >> 1) & 1), p[2] - 1 + (b >> 2)]));
    const around = cells.map((c) => filled.has(c));
    for (const want of [true, false]) {
      const members = around.flatMap((x, b) => (x === want ? [b] : []));
      if (members.length === 0) continue;
      const reached = new Set([members[0]]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of members)
          if (!reached.has(m) && [...reached].some((r) => [1, 2, 4].includes(r ^ m))) {
            reached.add(m);
            grew = true;
          }
      }
      if (reached.size !== members.length && counts(cells)) return true;
    }
  }
  return false;
}

/** The connected solids of a set of cells, each a set. */
function lumps(filled: ReadonlySet<string>): Set<string>[] {
  const left = new Set(filled);
  const out: Set<string>[] = [];
  for (const start of [...filled].sort((a, b) => before(p3(a), p3(b)))) {
    if (!left.has(start)) continue;
    left.delete(start);
    const lump = new Set([start]);
    const todo = [start];
    while (todo.length > 0) {
      const p = p3(todo.pop()!);
      for (let d = 0; d < 6; d++) {
        const n = k3(step(p, d));
        if (left.has(n)) {
          left.delete(n);
          lump.add(n);
          todo.push(n);
        }
      }
    }
    out.push(lump);
  }
  return out;
}

class Refused extends Error {}

/** No lone surrogate: text that can be written into a name. */
const wellFormed = (id: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(id);

export interface CellsBody {
  id: string;
  volume: number;
  low: P;
  faces: { names: string[]; facing: Facing; at: number; area: number; low: P; full: string; tag: string[] | null; squares: string[] }[];
  edges: { name: string | null; faces: [string, string]; ends: string[]; length: number }[];
}

export interface CellsRebuild {
  bodies: CellsBody[];
  failed: Set<string>;
  /** Rule 3's tag of the face at `index` (bodies' faces flattened in order) among the faces carrying `name`. */
  tagFor(index: number, name: string): string[];
}

/** Every coordinate a block uses is a whole number, so the unit-cell count can be made of it. */
export function cellsCanCount(features: readonly BooleanFeature[]): boolean {
  return features.every((f) => f.kind !== "block" || [...f.rect, ...f.z].every(Number.isInteger));
}

/** Every feature in order, by section 8's words, on unit cells. Features that fail keep every body as it was. */
export function countOnCells(features: readonly BooleanFeature[]): CellsRebuild {
  if (!cellsCanCount(features)) throw new Error("the unit-cell count needs whole-millimetre blocks");
  // Made order of a face name: the feature's place in the timeline, then start, end, the sides by line.
  const made = new Map<string, [number, number]>();
  const place = new Map<string, number>();
  features.forEach((f, i) => {
    place.set(f.id, i);
    if (f.kind !== "block") return;
    const lines = f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
    if (![f.id, ...lines].every((x) => wellFormed(x))) return;
    made.set(`face:${esc(f.id)}/start`, [i, 0]);
    made.set(`face:${esc(f.id)}/end`, [i, 1]);
    lines.forEach((l, j) => made.set(`face:${esc(f.id)}/side:${esc(l)}`, [i, 2 + j]));
  });
  const madeOf = (name: string) => made.get(name) ?? [Infinity, Infinity];
  // Earliest-made body: by the feature in the id, then body:F before body:F/piece:1 before piece:2.
  const bodyOrder = (id: string): [number, number] => {
    const at = id.indexOf("/piece:");
    const feature = decodeURIComponent(id.slice("body:".length, at < 0 ? undefined : at));
    return [place.get(feature) ?? Infinity, at < 0 ? 0 : Number(id.slice(at + "/piece:".length))];
  };

  /**
   * The faces of a solid with each face's names in rule 4's order: by the
   * participant they came from (`from`), then by how early the name stood
   * in the lists it came in (a face shown under one name keeps showing it),
   * then made order. Every square of a face then carries that list.
   */
  const settle = (s: Cells, from: (name: string) => number): Cells => {
    const names = new Map<string, string[]>();
    for (const { squares } of groupFaces(s)) {
      const all: string[] = [];
      const placeIn = new Map<string, number>();
      for (const q of squares)
        s.names.get(q)!.forEach((n, i) => {
          if (!placeIn.has(n)) all.push(n);
          placeIn.set(n, Math.min(i, placeIn.get(n) ?? i));
        });
      all.sort((x, y) => from(x) - from(y) || placeIn.get(x)! - placeIn.get(y)! || before(madeOf(x), madeOf(y)));
      for (const q of squares) names.set(q, all);
    }
    return { filled: s.filled, names };
  };
  const fromParticipants = (order: readonly Cells[]) => {
    const first = new Map<string, number>();
    order.forEach((s, i) => {
      for (const l of s.names.values()) for (const n of l) if (!first.has(n)) first.set(n, i);
    });
    return (name: string) => first.get(name) ?? order.length;
  };

  /** A solid's faces, in made order of their shown names, ties by lowest corner. */
  const facesOf = (s: Cells): CFace[] =>
    groupFaces(s)
      .map(({ d, squares }) => ({ d, squares, names: s.names.get(squares[0])!, low: lowest(squares.map(squareLow)) }))
      .sort((a, b) => before(madeOf(a.names[0]), madeOf(b.names[0])) || before(a.low, b.low));

  const piece = (s: Cells, lump: ReadonlySet<string>): Cells => ({
    filled: new Set(lump),
    names: new Map([...s.names].filter(([q]) => lump.has(unsq(q)[0]))),
  });

  /**
   * Rule 1's ranking of the lumps of `after` against the body as it was:
   * walk its old faces in made order; the first face reaching a lump, then
   * that lump's share of it, then volume, then lowest corner. The keeper is
   * the lump holding the first face whose surviving part is in one lump,
   * else the first by rank, unless `keeper` says (a Combine join: the lump
   * holding the target).
   */
  const rank = (old: Cells, after: Cells, parts: Set<string>[], keeper?: number): { keep: number; rest: number[] } => {
    const lumpAt = new Map<string, number>();
    parts.forEach((l, i) => l.forEach((c) => lumpAt.set(c, i)));
    const lumpOf = (cell: string) => lumpAt.get(cell)!;
    const firstFace = parts.map(() => Infinity);
    const share = parts.map(() => 0);
    let keep = keeper ?? -1;
    facesOf(old).forEach((f, w) => {
      const reached = new Map<number, number>();
      for (const q of f.squares) {
        if (!(after.names.get(q) ?? []).includes(f.names[0])) continue;
        const l = lumpOf(unsq(q)[0]);
        reached.set(l, (reached.get(l) ?? 0) + 1);
      }
      for (const [l, area] of reached)
        if (firstFace[l] === Infinity) {
          firstFace[l] = w;
          share[l] = area;
        }
      if (keep < 0 && reached.size === 1) keep = [...reached.keys()][0];
    });
    const lows = parts.map((l) => lowest([...l].map(p3)));
    const order = parts.map((_, i) => i).sort((a, b) => firstFace[a] - firstFace[b] || share[b] - share[a] || parts[b].size - parts[a].size || before(lows[a], lows[b]));
    if (keep < 0) keep = order[0];
    return { keep, rest: order.filter((i) => i !== keep) };
  };

  let bodies: { id: string; cells: Cells }[] = [];
  const failed = new Set<string>();
  for (const f of features) {
    try {
      const get = (id: string) => {
        const b = bodies.find((x) => x.id === id);
        if (!b) throw new Refused();
        return b;
      };
      if (f.kind === "block") {
        const [x0, y0, x1, y1] = f.rect;
        const lines = f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
        if (!(x0 < x1 && y0 < y1 && f.z[0] < f.z[1]) || new Set(lines).size !== 4 || ![f.id, ...lines].every((x) => wellFormed(x))) throw new Refused();
        const block = blockCells(f);
        if (f.operation === "new") {
          bodies.push({ id: `body:${esc(f.id)}`, cells: block });
          continue;
        }
        const listed: typeof bodies = [];
        for (const id of f.bodies ?? []) {
          const b = get(id);
          if (!listed.includes(b)) listed.push(b);
        }
        if (f.operation === "join") {
          // The earliest participant first, the extrude last.
          const inputs = [...listed].sort((a, b) => before(bodyOrder(a.id), bodyOrder(b.id)));
          const order = [...inputs.map((b) => b.cells), block];
          let raw = order[0];
          for (const s of order.slice(1)) raw = apply(raw, s, "join");
          // An edge or corner touch is refused where the extrude is one of the cells round it, or where the cells round it end up one body;
          // listed bodies that touched that way before and stay apart are not this feature's doing.
          const joined = lumps(raw.filled);
          const lumpOf = (c: string) => joined.findIndex((l) => l.has(c));
          if (pinches(raw.filled, (cells) => cells.some((c) => block.filled.has(c)) || new Set(cells.filter((c) => raw.filled.has(c)).map(lumpOf)).size === 1)) throw new Refused();
          const after = settle(raw, fromParticipants(order));
          const out = lumps(after.filled).map((l) => {
            const holding = inputs.find((b) => [...b.cells.filled].some((c) => l.has(c)));
            return { id: holding?.id ?? `body:${esc(f.id)}`, cells: piece(after, l) };
          });
          bodies = [...bodies.filter((b) => !listed.includes(b)), ...out];
          continue;
        }
        // A cut, each listed body in the order listed, the new pieces numbered on across them.
        let n = 1;
        const out = new Map<(typeof bodies)[number], typeof bodies>();
        for (const b of listed) {
          const made = cutOrIntersect(b, [block], "cut", f.id, n);
          n += made.length - 1;
          out.set(b, made);
        }
        bodies = bodies.flatMap((b) => out.get(b) ?? [b]);
        continue;
      }
      if (!wellFormed(f.id)) throw new Refused();
      const target = get(f.target);
      const tools = f.tools.map(get);
      if (tools.length === 0 || tools.includes(target) || new Set(tools).size < tools.length) throw new Refused();
      let made: typeof bodies;
      if (f.operation === "join") {
        const order = [target.cells, ...tools.map((t) => t.cells)];
        let raw = order[0];
        for (const s of order.slice(1)) raw = apply(raw, s, "join");
        if (pinches(raw.filled)) throw new Refused();
        const after = settle(raw, fromParticipants(order));
        const parts = lumps(after.filled);
        // Section 8, joins: the piece holding the target keeps its id; the tools' pieces left apart are new bodies.
        const holder = parts.findIndex((l) => l.has([...target.cells.filled][0]));
        const { keep, rest } = rank(target.cells, after, parts, holder);
        made = [{ id: target.id, cells: piece(after, parts[keep]) }, ...rest.map((l, i) => ({ id: `body:${esc(f.id)}/piece:${i + 1}`, cells: piece(after, parts[l]) }))];
      } else made = cutOrIntersect(target, tools.map((t) => t.cells), f.operation, f.id, 1);
      const used = f.keepTools ? [] : tools;
      bodies = bodies.flatMap((b) => (b === target ? made : used.includes(b) ? [] : [b]));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      failed.add(f.id);
    }
  }

  function cutOrIntersect(body: { id: string; cells: Cells }, toolCells: readonly Cells[], op: "cut" | "intersect", feature: string, first: number) {
    let raw = body.cells;
    for (const t of toolCells) raw = apply(raw, t, op);
    if (raw.filled.size === 0 || pinches(raw.filled)) throw new Refused();
    const after = settle(raw, fromParticipants([body.cells, ...toolCells]));
    const parts = lumps(after.filled);
    const { keep, rest } = rank(body.cells, after, parts);
    return [{ id: body.id, cells: piece(after, parts[keep]) }, ...rest.map((l, i) => ({ id: `body:${esc(feature)}/piece:${first + i}`, cells: piece(after, parts[l]) }))];
  }

  bodies.sort((a, b) => before(bodyOrder(a.id), bodyOrder(b.id)));
  return { ...describeCells(bodies, facesOf), failed };
}

/** Faces with tags (rule 3) and edges (rule 5) for every body. */
function describeCells(bodies: readonly { id: string; cells: Cells }[], facesOf: (s: Cells) => CFace[]): Omit<CellsRebuild, "failed"> {
  const faces: { body: number; f: CFace }[] = [];
  const faceAt = new Map<string, number>(); // "body|square" → index into faces
  bodies.forEach((b, bi) => {
    for (const f of facesOf(b.cells)) {
      for (const q of f.squares) faceAt.set(`${bi}|${q}`, faces.length);
      faces.push({ body: bi, f });
    }
  });
  const shown = (i: number) => faces[i].f.names[0];

  // Unit edges: along each axis, at each lattice line, the four cells round it; one or three filled is an edge.
  const unitEdges: { body: number; axis: number; from: P; pair: [number, number] }[] = [];
  bodies.forEach((b, bi) => {
    const lines = new Set<string>();
    for (const c of b.cells.filled) {
      const p = p3(c);
      for (let axis = 0; axis < 3; axis++)
        for (let s = 0; s < 4; s++) {
          const q = [...p] as P;
          q[(axis + 1) % 3] += s & 1;
          q[(axis + 2) % 3] += s >> 1;
          lines.add(`${axis}|${k3(q)}`);
        }
    }
    for (const line of [...lines].sort()) {
      const [axisText, at] = line.split("|");
      const axis = Number(axisText);
      const q = p3(at);
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
      // The four cells round the unit segment from q along the axis: offsets −1 or 0 in u and v.
      const cell = (du: number, dv: number) => {
        const c = [...q] as P;
        c[u] += du;
        c[v] += dv;
        return k3(c);
      };
      const quad: [number, number][] = [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ];
      const inside = quad.map(([du, dv]) => b.cells.filled.has(cell(du, dv)));
      const count = inside.filter(Boolean).length;
      if (count !== 1 && count !== 3) continue;
      const odd = inside.indexOf(count === 1);
      const [du, dv] = quad[odd];
      // The way from the odd cell towards the others, in u and in v.
      const du2 = du === -1 ? 0 : -1;
      const dv2 = dv === -1 ? 0 : -1;
      const dirOf = (ax: number, towardsPositive: boolean) => 2 * ax + (towardsPositive ? 1 : 0);
      let a: string;
      let bq: string;
      if (count === 1) {
        // The lone filled cell's squares facing the two empty cells beside it.
        a = sq(cell(du, dv), dirOf(u, du === -1));
        bq = sq(cell(du, dv), dirOf(v, dv === -1));
      } else {
        // The two filled cells beside the empty one, each facing it.
        a = sq(cell(du2, dv), dirOf(u, du2 === -1));
        bq = sq(cell(du, dv2), dirOf(v, dv2 === -1));
      }
      const fa = faceAt.get(`${bi}|${a}`)!;
      const fb = faceAt.get(`${bi}|${bq}`)!;
      unitEdges.push({ body: bi, axis, from: q, pair: fa < fb ? [fa, fb] : [fb, fa] });
    }
  });

  const neighbours = faces.map(() => new Set<string>());
  for (const e of unitEdges) {
    neighbours[e.pair[0]].add(shown(e.pair[1]));
    neighbours[e.pair[1]].add(shown(e.pair[0]));
  }
  const carrying = new Map<string, number[]>();
  faces.forEach((x, i) => x.f.names.forEach((n) => carrying.set(n, [...(carrying.get(n) ?? []), i])));
  const carriers = (name: string) => carrying.get(name) ?? [];
  const tagFor = (i: number, name: string) => {
    const others = new Set(carriers(name).filter((j) => j !== i).flatMap((j) => [...neighbours[j]]));
    return [...neighbours[i]].filter((n) => !others.has(n)).sort();
  };
  const tags = faces.map((x, i) => (carriers(x.f.names[0]).length > 1 ? tagFor(i, x.f.names[0]) : null));
  const full = faces.map((x, i) => (tags[i] === null ? x.f.names[0] : `${x.f.names[0]}#${tags[i]!.join(",")}`));

  // Whole edges: unit edges on one line, one after another, between the same two faces.
  const byLine = new Map<string, typeof unitEdges>();
  for (const e of unitEdges) {
    const line = [...e.from];
    line[e.axis] = 0;
    const k = `${e.body}|${e.axis}|${k3(line)}|${e.pair.join(",")}`;
    byLine.set(k, [...(byLine.get(k) ?? []), e]);
  }
  /** Shown names of the faces with a square touching lattice point `p` on body `bi`, but `pair`'s. */
  const facesAtPoint = (bi: number, p: P, pair: readonly number[]) => {
    const out = new Set<string>();
    for (let b = 0; b < 8; b++) {
      const c = [p[0] - 1 + (b & 1), p[1] - 1 + ((b >> 1) & 1), p[2] - 1 + (b >> 2)];
      for (let d = 0; d < 6; d++) {
        // The square of cell c facing d touches p only if p is on that side of c.
        const ax = DIRS[d][0];
        const side = c[ax] + (DIRS[d][1] === 1 ? 1 : 0);
        if (side !== p[ax]) continue;
        const f = faceAt.get(`${bi}|${sq(k3(c), d)}`);
        if (f !== undefined && !pair.includes(f)) out.add(shown(f));
      }
    }
    return out;
  };
  const runs: { body: number; pair: [number, number]; ends: string[]; length: number; at: P; axis: number }[] = [];
  for (const list of byLine.values()) {
    list.sort((a, b) => a.from[a.axis] - b.from[b.axis]);
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].from[list[j].axis] === list[j].from[list[j].axis] + 1) j++;
      const start = list[i].from;
      const end = [...list[j].from] as P;
      end[list[j].axis] += 1;
      const ends = new Set([...facesAtPoint(list[i].body, start, list[i].pair), ...facesAtPoint(list[i].body, end, list[i].pair)]);
      runs.push({ body: list[i].body, pair: list[i].pair, ends: [...ends].sort(), length: j - i + 1, at: start, axis: list[i].axis });
      i = j + 1;
    }
  }
  const pairName = (r: (typeof runs)[number]) => `edge:${[full[r.pair[0]], full[r.pair[1]]].sort().join("+")}`;
  const pairCount = new Map<string, number>();
  for (const r of runs) pairCount.set(pairName(r), (pairCount.get(pairName(r)) ?? 0) + 1);
  const withEnds = runs.map((r) => (pairCount.get(pairName(r))! > 1 ? `${pairName(r)};ends:${r.ends.join(",")}` : pairName(r)));
  const nameCount = new Map<string, number>();
  for (const n of withEnds) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);

  return {
    bodies: bodies.map((b, bi) => {
      let low: P | null = null;
      for (const c of b.cells.filled) if (low === null || before(p3(c), low) < 0) low = p3(c);
      return {
        id: b.id,
        volume: b.cells.filled.size,
        low: low!,
        faces: faces.flatMap((x, i) =>
          x.body !== bi ? [] : [{ names: x.f.names, facing: FACING_NAMES[x.f.d], at: x.f.low[DIRS[x.f.d][0]], area: x.f.squares.length, low: x.f.low, full: full[i], tag: tags[i], squares: x.f.squares }],
        ),
        edges: runs.flatMap((r, i) =>
          r.body !== bi ? [] : [{ name: nameCount.get(withEnds[i]) === 1 ? withEnds[i] : null, faces: [full[r.pair[0]], full[r.pair[1]]].sort() as [string, string], ends: r.ends, length: r.length }],
        ),
      };
    }),
    tagFor,
  };
}

// References (rule 3) on the count ---------------------------------------------

export type Found = { body: string; full: string } | "lost" | { ambiguous: number };

/** Does a face hold a point (on it, borders included)? */
const faceHolds = (f: CellsBody["faces"][number], p: readonly number[]) =>
  f.squares.some((s) => {
    const lo = squareLow(s);
    const ax = DIRS[unsq(s)[1]][0];
    return p.every((x, i) => (i === ax ? x === lo[i] : lo[i] <= x && x <= lo[i] + 1));
  });

/** Section 8's references by words: one carrier is it; a tag picks its piece; else the piece holding the origin, else the largest; a tie is never guessed. Also whether a warning is due. */
export function resolveOnCells(r: CellsRebuild, ref: { name: string; tag?: readonly string[]; origin?: readonly number[] }): { found: Found; warned: boolean } {
  const all = r.bodies.flatMap((b) => b.faces.map((f) => ({ b, f })));
  const carrying = all.map((x, i) => ({ ...x, i })).filter((x) => x.f.names.includes(ref.name));
  const one = (x: (typeof carrying)[number]) => ({ body: x.b.id, full: x.f.full });
  if (carrying.length === 0) return { found: "lost", warned: false };
  if (carrying.length === 1) return { found: one(carrying[0]), warned: false };
  if (ref.tag) {
    const tag = ref.tag.join(",");
    const same = carrying.filter((x) => r.tagFor(x.i, ref.name).join(",") === tag);
    if (same.length === 0) return { found: "lost", warned: false };
    return same.length === 1 ? { found: one(same[0]), warned: false } : { found: { ambiguous: same.length }, warned: false };
  }
  const holding = ref.origin ? carrying.filter((x) => faceHolds(x.f, ref.origin!)) : [];
  if (holding.length === 1) return { found: one(holding[0]), warned: true };
  const most = Math.max(...carrying.map((x) => x.f.area));
  const largest = carrying.filter((x) => x.f.area === most);
  return largest.length === 1 ? { found: one(largest[0]), warned: true } : { found: { ambiguous: largest.length }, warned: false };
}

/** Section 8's edge references by words: the one edge with the name; two or more fitting it (its faces now meet more than once) ambiguous; else lost. */
export function resolveEdgeOnCells(r: CellsRebuild, name: string): Found {
  const exact = r.bodies.flatMap((b) => b.edges.filter((e) => e.name === name).map(() => ({ body: b.id, full: name })));
  if (exact.length === 1) return exact[0];
  const fits = r.bodies.flatMap((b) => b.edges).filter((e) => {
    const pair = `edge:${e.faces.join("+")}`;
    return name === pair || name === `${pair};ends:${e.ends.join(",")}`;
  }).length;
  return fits > 1 ? { ambiguous: fits } : "lost";
}
