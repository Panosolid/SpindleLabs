// Seeded sessions of blocks, Extrude joins and cuts and Combines (step
// 34a5), each step checked two ways:
//
// - against the second, independent count on unit cells
//   (boolean-naming-cells.ts): every body's id, volume and lowest corner,
//   every face's names, tag, area and place, every edge's name, faces, ends
//   and length, which features failed, and every reference the session
//   made so far (faces by name, with or without a tag and an origin, and
//   edges by name) found the same way;
// - names are about the part, not where it is or what its ids are called:
//   the same session moved and scaled (by 2.5, and 1000.25 mm out) gives the
//   same names, with volumes, areas and lengths scaled; the same session
//   with every feature's and line's id renamed gives the same names with the
//   ids renamed back (lists the rules sort by text sorted again).
//
// `firstDifference` says where the two disagree, in words, or null; the
// planted faults (BOOLEAN_FAULTS) must each make some seed disagree
// (test/boolean-naming-session.test.ts).

import { seeded, type SeededRandom } from "./index.ts";
import {
  rebuildBooleans,
  resolveEdge,
  resolveFace,
  type BlockFeature,
  type BooleanFault,
  type BooleanFeature,
  type BooleanRebuild,
  type CombineFeature,
} from "./boolean-naming-model.ts";
import { countOnCells, resolveOnCells, type CellsRebuild } from "./boolean-naming-cells.ts";

/** A reference a session made: a face by one of its names (with its tag when made on a piece, and the sketch's origin), or an edge by name. */
export type SessionReference = { kind: "face"; name: string; tag?: readonly string[]; origin?: readonly [number, number, number] } | { kind: "edge"; name: string };

export interface BooleanSession {
  seed: bigint;
  features: BooleanFeature[];
  /** Each made after the feature at `after` (its index) was added. */
  references: { after: number; ref: SessionReference }[];
}

const pick = <T>(r: SeededRandom, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];
const int = (r: SeededRandom, lo: number, hi: number) => lo + Math.floor(r.next() * (hi - lo + 1));
function some<T>(r: SeededRandom, xs: readonly T[], most: number): T[] {
  const left = [...xs];
  const out: T[] = [];
  const n = Math.min(left.length, int(r, 1, most));
  while (out.length < n) out.push(left.splice(Math.floor(r.next() * left.length), 1)[0]);
  return out;
}

/** A small block: corners on whole millimetres in 0–8 (x, y) and 0–6 (z), so the unit-cell count is cheap. */
function randomBlock(r: SeededRandom, id: string, operation: BlockFeature["operation"], bodies?: string[], slab = false): BlockFeature {
  const x0 = int(r, 0, 6);
  const y0 = int(r, 0, 6);
  const z0 = int(r, 0, 4);
  const f: BlockFeature = { kind: "block", id, rect: [x0, y0, Math.min(8, x0 + int(r, 1, 5)), Math.min(8, y0 + int(r, 1, 5))], z: [z0, Math.min(6, z0 + int(r, 1, 4))], operation };
  // Sometimes a slab right through everything, upright along x or y or flat (a slot), so cuts split bodies into pieces.
  if (r.next() < (operation === "join" ? 0.1 : 0.3) || slab) {
    const along = int(r, 0, 2);
    const at = int(r, 1, along === 2 ? 4 : 6);
    const width = int(r, 1, 2);
    f.rect = along === 0 ? [-1, at, 9, at + width] : along === 1 ? [at, -1, at + width, 9] : [-1, -1, 9, 9];
    f.z = along === 2 ? [at, at + width] : [-1, 7];
  }
  if (bodies) f.bodies = bodies;
  // Sometimes the rectangle's lines have other ids (a sketch drawn in another order).
  if (r.next() < 0.3) {
    const ids = ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6"];
    f.lines = some(r, ids, 4).concat(ids).filter((x, i, all) => all.indexOf(x) === i).slice(0, 4) as unknown as BlockFeature["lines"];
  }
  return f;
}

/**
 * A seeded session of `steps` features. What it picks depends on the
 * bodies there are (it rebuilds the model as it goes), now and then a body
 * that is not there (the feature must fail), and after each feature it may
 * make references to what it sees.
 */
export function randomBooleanSession(seed: bigint, steps: number): BooleanSession {
  const r = seeded(seed);
  const features: BooleanFeature[] = [];
  const references: BooleanSession["references"] = [];
  let ids: string[] = [];
  let rebuild: BooleanRebuild | null = null;
  while (features.length < steps) {
    const id = `feature-${features.length + 1}`;
    const choice = r.next();
    const listed = () => (r.next() < 0.05 ? ["body:nowhere"] : some(r, ids, 2));
    if (ids.length === 0 || choice < 0.26) features.push(randomBlock(r, id, "new"));
    else if (choice < 0.42) features.push(randomBlock(r, id, "join", listed()));
    else if (choice < 0.62) features.push(randomBlock(r, id, "cut", listed()));
    else if (choice < 0.7) {
      // A slot through every body there is: an Extrude cut listing them all, numbering pieces on across them.
      features.push(randomBlock(r, id, "cut", some(r, ids, ids.length), true));
    } else if (choice < 0.78 && features.length + 3 <= steps) {
      // Two slots made as bodies, then cut from one body by a Combine: three or more pieces from one body.
      const target = pick(r, ids);
      features.push(randomBlock(r, id, "new", undefined, true));
      features.push(randomBlock(r, `feature-${features.length + 1}`, "new", undefined, true));
      const n = features.length;
      features.push({ kind: "combine", id: `feature-${n + 1}`, target, tools: [`body:feature-${n - 1}`, `body:feature-${n}`], operation: "cut", keepTools: r.next() < 0.25 });
    } else if (choice < 0.82 && features.length + 4 <= steps) {
      // A small block swallowed by a bigger one, joined by a Combine that also takes a block apart: the target's faces all vanish, and the piece holding it must still keep its id.
      const x = int(r, 1, 2);
      const y = int(r, 1, 6);
      const z = int(r, 1, 4);
      const n = features.length;
      features.push({ kind: "block", id, rect: [x, y, x + 1, y + 1], z: [z, z + 1], operation: "new" });
      features.push({ kind: "block", id: `feature-${n + 2}`, rect: [x - 1, y - 1, x + 2, y + 2], z: [z - 1, z + 2], operation: "new" });
      const ax = x + 3;
      const ay = int(r, 0, 5);
      features.push({ kind: "block", id: `feature-${n + 3}`, rect: [ax, ay, ax + int(r, 2, 5), ay + int(r, 2, 4)], z: [0, int(r, 2, 6)], operation: "new" });
      features.push({ kind: "combine", id: `feature-${n + 4}`, target: `body:${id}`, tools: r.next() < 0.5 ? [`body:feature-${n + 2}`, `body:feature-${n + 3}`] : [`body:feature-${n + 3}`, `body:feature-${n + 2}`], operation: "join", keepTools: r.next() < 0.25 });
    } else {
      const target = pick(r, ids);
      const rest = ids.filter((x) => x !== target);
      const tools = r.next() < 0.05 || rest.length === 0 ? [target] : some(r, rest, 2);
      const c: CombineFeature = { kind: "combine", id, target, tools, operation: pick(r, ["join", "cut", "intersect"] as const), keepTools: r.next() < 0.25 };
      features.push(c);
    }
    rebuild = rebuildBooleans(features);
    ids = rebuild.bodies.map((b) => b.id);
    // References to what is there now: a face or two, an edge.
    const faces = rebuild.bodies.flatMap((b) => b.faces);
    for (let n = int(r, 0, 2); n > 0 && faces.length > 0; n--) {
      const face = pick(r, faces);
      const name = r.next() < 0.8 ? face.names[0] : pick(r, face.names);
      const [lo, hi] = pick(r, face.rects);
      const t = () => pick(r, [0, 0.25, 0.5, 1]);
      const origin = [0, 1, 2].map((a) => lo[a] + t() * (hi[a] - lo[a])) as [number, number, number];
      const ref: SessionReference = { kind: "face", name };
      if (r.next() < 0.7) ref.origin = origin;
      if (face.tag !== null && name === face.names[0] && r.next() < 0.6) ref.tag = face.tag;
      references.push({ after: features.length - 1, ref });
    }
    const edges = rebuild.bodies.flatMap((b) => b.edges).filter((e) => e.name !== null);
    if (edges.length > 0 && r.next() < 0.5) references.push({ after: features.length - 1, ref: { kind: "edge", name: pick(r, edges).name! } });
  }
  return { seed, features, references };
}

// The comparison ----------------------------------------------------------------

/** One body as text, the same shape for both counts. */
interface Shape {
  bodies: { id: string; volume: number; low: readonly number[]; faces: string[]; edges: string[] }[];
  failed: string[];
}

const faceText = (f: { names: readonly string[]; facing: string; at: number; area: number; low: readonly number[]; full: string; tag: readonly string[] | null }) =>
  `${f.full} [${f.names.join(" | ")}] ${f.facing}@${f.at} area ${f.area} low ${f.low.join(",")} tag ${f.tag === null ? "-" : f.tag.join(",")}`;
const edgeText = (e: { name: string | null; faces: readonly string[]; ends: readonly string[]; length: number }) => `${e.name ?? "(shared)"} {${e.faces.join(" + ")}} ends ${e.ends.join(",")} length ${e.length}`;

function modelShape(r: BooleanRebuild): Shape {
  return {
    bodies: r.bodies.map((b) => ({ id: b.id, volume: b.volume, low: b.low, faces: b.faces.map(faceText), edges: b.edges.map(edgeText).sort() })),
    failed: [...r.failed.keys()].sort(),
  };
}

function cellsShape(r: CellsRebuild): Shape {
  return {
    bodies: r.bodies.map((b) => ({ id: b.id, volume: b.volume, low: b.low, faces: b.faces.map(faceText), edges: b.edges.map(edgeText).sort() })),
    failed: [...r.failed].sort(),
  };
}

/** The first place two shapes differ, in words, or null. */
export function shapeDifference(a: Shape, b: Shape, labels: readonly [string, string]): string | null {
  if (a.failed.join() !== b.failed.join()) return `failed: ${labels[0]} ${a.failed.join(",") || "none"}, ${labels[1]} ${b.failed.join(",") || "none"}`;
  const ids = (s: Shape) => s.bodies.map((x) => x.id).join(" ");
  if (ids(a) !== ids(b)) return `bodies: ${labels[0]} ${ids(a)}; ${labels[1]} ${ids(b)}`;
  for (let i = 0; i < a.bodies.length; i++) {
    const [x, y] = [a.bodies[i], b.bodies[i]];
    if (x.volume !== y.volume || x.low.join() !== y.low.join()) return `${x.id}: ${labels[0]} volume ${x.volume} low ${x.low}, ${labels[1]} volume ${y.volume} low ${y.low}`;
    for (const [what, p, q] of [
      ["face", x.faces, y.faces],
      ["edge", x.edges, y.edges],
    ] as const) {
      if (p.length !== q.length) return `${x.id}: ${labels[0]} has ${p.length} ${what}s, ${labels[1]} ${q.length}`;
      for (let j = 0; j < p.length; j++) if (p[j] !== q[j]) return `${x.id} ${what} ${j}: ${labels[0]} ${p[j]}; ${labels[1]} ${q[j]}`;
    }
  }
  return null;
}

function modelFinds(r: BooleanRebuild, ref: SessionReference, faults: readonly BooleanFault[]): string {
  if (ref.kind === "edge") {
    const e = resolveEdge(r, ref.name);
    return "lost" in e ? "lost" : `${e.body} ${e.found.name}`;
  }
  const f = resolveFace(r, ref, faults);
  if ("lost" in f) return "lost";
  if ("ambiguous" in f) return `ambiguous ${f.ambiguous}`;
  return `${f.body} ${f.found.full}${f.warning ? " (warned)" : ""}`;
}

function cellsFinds(r: CellsRebuild, ref: SessionReference): string {
  if (ref.kind === "edge") {
    const hits = r.bodies.flatMap((b) => b.edges.filter((e) => e.name === ref.name).map(() => `${b.id} ${ref.name}`));
    return hits.length === 1 ? hits[0] : "lost";
  }
  const { found, warned } = resolveOnCells(r, ref);
  if (found === "lost") return "lost";
  if ("ambiguous" in found) return `ambiguous ${found.ambiguous}`;
  return `${found.body} ${found.full}${warned ? " (warned)" : ""}`;
}

/**
 * Every step of the session, the model (with `faults` planted) against
 * the unit-cell count: the first disagreement in words, or null.
 */
export function firstDifference(s: BooleanSession, faults: readonly BooleanFault[] = []): string | null {
  for (let i = 1; i <= s.features.length; i++) {
    const timeline = s.features.slice(0, i);
    const model = rebuildBooleans(timeline, faults);
    const cells = countOnCells(timeline);
    const d = shapeDifference(modelShape(model), cellsShape(cells), ["model", "cells"]);
    if (d !== null) return `seed ${s.seed}, step ${i}: ${d}`;
    for (const { after, ref } of s.references) {
      if (after >= i) continue;
      const [m, c] = [modelFinds(model, ref, faults), cellsFinds(cells, ref)];
      if (m !== c) return `seed ${s.seed}, step ${i}: ${ref.kind} reference ${ref.name}${ref.kind === "face" && ref.tag ? ` #${ref.tag.join(",")}` : ""}: model ${m}, cells ${c}`;
    }
  }
  return null;
}

// Moving, scaling and renaming ----------------------------------------------------

/** The session's blocks moved by `by` after scaling about the origin by `scale`. */
export function moved(features: readonly BooleanFeature[], scale: number, by: readonly [number, number, number]): BooleanFeature[] {
  return features.map((f) =>
    f.kind !== "block"
      ? f
      : {
          ...f,
          rect: [f.rect[0] * scale + by[0], f.rect[1] * scale + by[1], f.rect[2] * scale + by[0], f.rect[3] * scale + by[1]],
          z: [f.z[0] * scale + by[2], f.z[1] * scale + by[2]],
        },
  );
}

/** The model's answer for a moved session put back: places and corners back, volumes, areas and lengths unscaled. */
function unmovedShape(r: BooleanRebuild, scale: number, by: readonly [number, number, number]): Shape {
  const back = (p: readonly number[]) => p.map((x, i) => (x - by[i]) / scale);
  const axis = { x: 0, y: 1, z: 2 } as const;
  return {
    bodies: r.bodies.map((b) => ({
      id: b.id,
      volume: b.volume / scale ** 3,
      low: back(b.low),
      faces: b.faces.map((f) => faceText({ ...f, at: (f.at - by[axis[f.facing[1] as "x" | "y" | "z"]]) / scale, area: f.area / scale ** 2, low: back(f.low) })),
      edges: b.edges.map((e) => edgeText({ ...e, length: e.length / scale })).sort(),
    })),
    failed: [...r.failed.keys()].sort(),
  };
}

/** The session with every feature's id and line id renamed by `rename` (bodies' and Combines' lists too). */
export function renamed(features: readonly BooleanFeature[], rename: (id: string) => string): BooleanFeature[] {
  const body = (id: string) => {
    const m = /^body:([^/]*)(\/piece:\d+)?$/.exec(id);
    return m ? `body:${encodeURIComponent(rename(decodeURIComponent(m[1])))}${m[2] ?? ""}` : id;
  };
  return features.map((f) => {
    if (f.kind === "combine") return { ...f, id: rename(f.id), target: body(f.target), tools: f.tools.map(body) };
    const lines = (f.lines ?? ["line-1", "line-2", "line-3", "line-4"]).map(rename) as unknown as BlockFeature["lines"];
    return { ...f, id: rename(f.id), lines, ...(f.bodies ? { bodies: f.bodies.map(body) } : {}) };
  });
}

/** A name (face, full face, body or edge) with its ids renamed back by `back`, and every list the rules sort by text sorted again. */
export function nameBack(name: string, back: (id: string) => string): string {
  const ids = name
    .replace(/(face:|body:)([^/+#,;@ ]+)/g, (_, kind: string, id: string) => kind + encodeURIComponent(back(decodeURIComponent(id))))
    .replace(/side:([^/+#,;@ ]+)/g, (_, id: string) => "side:" + encodeURIComponent(back(decodeURIComponent(id))));
  return sortedAgain(ids);
}

function sortedAgain(name: string): string {
  const full = (f: string) => {
    const at = f.indexOf("#");
    return at < 0 ? f : `${f.slice(0, at)}#${f.slice(at + 1).split(",").filter(Boolean).sort().join(",")}`;
  };
  if (!name.startsWith("edge:")) return full(name);
  const [pair, ...rest] = name.slice("edge:".length).split(";");
  const faces = pair.split("+").map(full).sort().join("+");
  const tail = rest.map((part) => (part.startsWith("ends:") ? `ends:${part.slice(5).split(",").sort().join(",")}` : part));
  return [`edge:${faces}`, ...tail].join(";");
}

function namesBackShape(r: BooleanRebuild, back: (id: string) => string): Shape {
  const n = (x: string) => nameBack(x, back);
  return {
    bodies: r.bodies.map((b) => ({
      id: n(b.id),
      volume: b.volume,
      low: b.low,
      faces: b.faces.map((f) => faceText({ ...f, names: f.names.map(n), full: n(f.full), tag: f.tag === null ? null : f.tag.map(n).sort() })),
      edges: b.edges.map((e) => edgeText({ name: e.name === null ? null : n(e.name), faces: e.faces.map(n).sort(), ends: e.ends.map(n).sort(), length: e.length })).sort(),
    })),
    failed: [...r.failed.keys()].map(back).sort(),
  };
}

/** The model's answer with every name put through `nameBack` with no renaming: what a renamed session's answer must equal. */
function sortedShape(r: BooleanRebuild): Shape {
  return namesBackShape(r, (id) => id);
}

export const SCALE = 2.5;
export const MOVE: readonly [number, number, number] = [1000.25, -3.5, 0.125];
/**
 * New ids for every feature and line id in the session, in reverse text
 * order of where they first appear (so an order taken from ids' text turns
 * round), each with every separator a name uses in it (so an id that leaked
 * unencoded into a name would show).
 */
export function strangeIds(features: readonly BooleanFeature[]): Map<string, string> {
  const ids = new Map<string, string>();
  const add = (id: string) => {
    if (!ids.has(id)) ids.set(id, `${String.fromCharCode(0x7a - (ids.size % 26))}${ids.size} /+#,;@:x`);
  };
  for (const f of features) {
    add(f.id);
    if (f.kind === "block") for (const l of f.lines ?? ["line-1", "line-2", "line-3", "line-4"]) add(l);
  }
  return ids;
}

/** The session moved and scaled, and renamed, against itself: the first disagreement in words, or null. */
export function invarianceDifference(s: BooleanSession, faults: readonly BooleanFault[] = []): string | null {
  const plain = rebuildBooleans(s.features, faults);
  const movedDiff = shapeDifference(modelShape(plain), unmovedShape(rebuildBooleans(moved(s.features, SCALE, MOVE), faults), SCALE, MOVE), ["as made", "moved"]);
  if (movedDiff !== null) return `seed ${s.seed}, moved: ${movedDiff}`;
  const to = strangeIds(s.features);
  const from = new Map([...to].map(([a, b]) => [b, a]));
  const back = (id: string) => from.get(id) ?? id;
  const renamedDiff = shapeDifference(sortedShape(plain), namesBackShape(rebuildBooleans(renamed(s.features, (id) => to.get(id) ?? id), faults), back), ["as made", "renamed"]);
  return renamedDiff === null ? null : `seed ${s.seed}, renamed: ${renamedDiff}`;
}
