// Step 35ec3: edge names (rule 5), references (rule 3's face references,
// rule 5's edge names) and old edge names (rule 6) on the real kernel's
// boolean results through the test-only Combine (boolean-combine.ts),
// checked against the exact naming model (packages/testing
// boolean-naming-model.ts `rebuildBooleans`, `resolveFace`, `resolveEdge`;
// old-names.ts `findOldEdgeAfterBooleans`): hand-worked cases first, then
// seeded sessions (BOOLEAN_NAMES_SEEDS, 200 by default; FISSION_SEED replays
// one), the boundaries and planted bugs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, GeometryReference, StableId } from "@fission/core";
import { rebuildBooleans, resolveEdge, resolveFace, type BooleanFeature, type BooleanRebuild } from "../../../packages/testing/src/boolean-naming-model.ts";
import { findOldEdgeAfterBooleans, readOldEdge } from "../../../packages/testing/src/old-names.ts";
import { designNames, faceHolds, resolveEdgeName, resolveFaceName, resolveOldEdge, SAME_CORNER, type DesignNames, type NamedBody, type NameFound } from "../src/boolean-names.ts";
import { oldEdgeFaces } from "../src/references.ts";
import { block, designRebuild, randomSession } from "./boolean-combine.ts";

// 200 seeds by default (about 2 s): 20 reach a pair of faces meeting twice
// only twice, too rarely to count on.
const SEEDS = process.env.FISSION_SEED !== undefined ? [BigInt(process.env.FISSION_SEED)] : [...Array(Number(process.env.BOOLEAN_NAMES_SEEDS ?? 200)).keys()].map((i) => 35_200n + BigInt(i));

const edgeRef = (id: string): GeometryReference => ({ kind: "edge", id: id as StableId });

/** Each body's edge names, sorted (a shared edge as "shared" and its faces and ends), by body id. */
function designEdges(bodies: readonly NamedBody[], names: DesignNames): Map<string, string[]> {
  return new Map(bodies.map((b, bi) => [b.id, names.edges[bi].map((e) => (e === null ? "unnamed" : (e.name ?? `shared ${e.faces.join("+")};${e.ends.join(",")}`))).sort()]));
}
function modelEdges(r: BooleanRebuild): Map<string, string[]> {
  return new Map(r.bodies.map((b) => [b.id, b.edges.map((e) => e.name ?? `shared ${e.faces.join("+")};${e.ends.join(",")}`).sort()]));
}

/** Where the two sides' edge names part, in words; null when they agree. */
function edgeDifference(d: Map<string, string[]>, m: Map<string, string[]>): string | null {
  if ([...d.keys()].sort().join() !== [...m.keys()].sort().join()) return `bodies: Design ${[...d.keys()]}, model ${[...m.keys()]}`;
  for (const [id, names] of d) {
    const other = m.get(id)!;
    const extra = names.filter((n) => !other.includes(n));
    const missing = other.filter((n) => !names.includes(n));
    if (extra.length + missing.length > 0 || names.length !== other.length) return `${id} edges: only Design ${extra.join("; ") || "none"}; only model ${missing.join("; ") || "none"} (${names.length} against ${other.length})`;
  }
  return null;
}

/** A found face or edge as both sides can say it: its body id and full name (an edge: faces and ends), with the warning. */
const saidFace = (bodies: readonly NamedBody[], names: DesignNames, f: NameFound): string =>
  "lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${bodies[f.body].id} ${names.full[f.body][f.index]} ${f.warning ?? ""}`;
const saidEdge = (bodies: readonly NamedBody[], names: DesignNames, f: NameFound): string => {
  if ("lost" in f || "ambiguous" in f) return saidFace(bodies, names, f);
  const e = names.edges[f.body][f.index]!;
  return `${bodies[f.body].id} ${e.faces.join("+")};${e.ends.join(",")}`;
};

// The notch: the bar 100 × 20 × 10 with a block cut out of its bottom front
// edge at x 30–40 (the tool y −1 to 5, z −1 to 3, poking out below and in
// front: the kernel refuses faces lying on each other until 36a).
const BAR = block("feature-1", [0, 0, 100, 20], [0, 10]);
const NOTCH = block("feature-2", [30, -1, 40, 5], [-1, 3]);
const NOTCHED: BooleanFeature[] = [BAR, NOTCH, { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "cut" }];

test("the notch by hand: the bottom and front now meet twice, told apart by the faces at their ends", async () => {
  const { bodies } = await designRebuild(NOTCHED);
  const names = designNames(bodies);
  const all = names.edges[0].map((e) => e!.name);
  // The bottom (start, z = 0) and the front (line 1's side, y = 0) met along
  // x 0–100; the notch leaves x 0–30, ending at the bar's x = 0 side (line 4)
  // and the notch's x = 30 wall (the tool's line 4), and x 40–100, ending at
  // the notch's x = 40 wall (its line 2) and the bar's x = 100 side (line 2).
  // "side" sorts before "start" ('i' < 't'), feature-1 before feature-2.
  const pair = "edge:face:feature-1/side:line-1+face:feature-1/start";
  assert.ok(all.includes(`${pair};ends:face:feature-1/side:line-4,face:feature-2/side:line-4`));
  assert.ok(all.includes(`${pair};ends:face:feature-1/side:line-2,face:feature-2/side:line-2`));
  // An edge whose two faces meet once has no ";ends:": the notch's ceiling
  // (the tool's end, z = 3) along its x = 30 wall.
  assert.ok(all.includes("edge:face:feature-2/end+face:feature-2/side:line-4"));
  // 12 edges of the bar, the 2 bottom-front ones in place of 1, and the
  // notch's 9 (ceiling's 4 sides, 2 walls' uprights at the back, 2 walls'
  // bottoms and front edges...): count them from the kernel instead, every
  // edge named, none shared.
  assert.ok(all.every((n) => n !== null));
  assert.equal(new Set(all).size, all.length);
  // References: the full new name finds its edge; the bare pair, written
  // before the two faces met twice, fits both and is never guessed.
  assert.ok("index" in resolveEdgeName(names, `${pair};ends:face:feature-1/side:line-2,face:feature-2/side:line-2`));
  assert.deepEqual(resolveEdgeName(names, pair), { ambiguous: 2 });
  assert.deepEqual(resolveEdgeName(names, "edge:face:feature-9/end+face:feature-9/start"), { lost: true });
  // Old names (rule 6): the bottom-front edge's old name now fits both
  // pieces of it; the bottom-right one (line 2 and start) met once and still does.
  const old = (id: string) => resolveOldEdge(bodies, ...oldEdgeFaces(edgeRef(id))!);
  assert.deepEqual(old("edge:feature-1/side:line-1+start"), { ambiguous: 2 });
  const right = old("edge:feature-1/side:line-2+start");
  assert.ok("index" in right);
  assert.equal(names.edges[right.body][right.index]!.name, "edge:face:feature-1/side:line-2+face:feature-1/start");
  // And the model says the same of every edge.
  assert.equal(edgeDifference(designEdges(bodies, names), modelEdges(rebuildBooleans(NOTCHED))), null);
});

// The F1 bar (35ec2's): cut by a slot right through at x 30–40, two pieces.
const SLOT = block("feature-2", [30, -1, 40, 21], [-1, 11]);
const F1: BooleanFeature[] = [BAR, SLOT, { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "cut" }];

test("F1 by hand: edges on split faces carry the tags, and a face reference finds its piece by tag or origin", async () => {
  const { bodies } = await designRebuild(F1);
  const names = designNames(bodies);
  // The far piece (body:feature-1, x 40–100): its top is the bar's end
  // tagged by the far side (line 2) and the slot's x = 40 wall (its line 2),
  // and it meets that wall once.
  const farTop = "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2";
  assert.equal(bodies[0].id, "body:feature-1");
  assert.ok(names.edges[0].some((e) => e!.name === `edge:${farTop}+face:feature-2/side:line-2`));
  // A reference to the whole top, with its sketch's origin at (70, 10, 10)
  // (on the far piece) or (10, 10, 10) (on the near one), finds that piece
  // with a warning; with no origin, the larger (the far one, 60 × 20
  // against 30 × 20), warned too; by its tag, the piece with that tag.
  const top = "face:feature-1/end";
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: top, origin: [70, 10, 10] })), `body:feature-1 ${farTop} split`);
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: top, origin: [10, 10, 10] })), `body:feature-3/piece:1 face:feature-1/end#face:feature-1/side:line-4,face:feature-2/side:line-4 split`);
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: top })), `body:feature-1 ${farTop} split`);
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: top, tag: ["face:feature-1/side:line-4", "face:feature-2/side:line-4"] })), `body:feature-3/piece:1 face:feature-1/end#face:feature-1/side:line-4,face:feature-2/side:line-4 `);
  // An origin in the slot (35, 10, 10), on neither piece: the larger, warned.
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: top, origin: [35, 10, 10] })), `body:feature-1 ${farTop} split`);
  // A tag no piece has is lost, never another piece; a face never split is found with no warning.
  assert.deepEqual(resolveFaceName(bodies, names, { name: top, tag: ["face:feature-1/side:line-1"] }), { lost: true });
  assert.equal(saidFace(bodies, names, resolveFaceName(bodies, names, { name: "face:feature-1/side:line-2" })), "body:feature-1 face:feature-1/side:line-2 ");
  assert.equal(edgeDifference(designEdges(bodies, names), modelEdges(rebuildBooleans(F1))), null);
});

test("two pieces of one face the same size with no origin are never guessed between", async () => {
  // The slot at x 45–55 halves the bar: both tops 45 × 20 = 900 mm², so a
  // whole-face reference with no origin is ambiguous, as the model's.
  const features: BooleanFeature[] = [BAR, block("feature-2", [45, -1, 55, 21], [-1, 11]), { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "cut" }];
  const { bodies } = await designRebuild(features);
  const names = designNames(bodies);
  assert.deepEqual(resolveFaceName(bodies, names, { name: "face:feature-1/end" }), { ambiguous: 2 });
  assert.deepEqual(resolveFace(rebuildBooleans(features), { name: "face:feature-1/end" }), { ambiguous: 2 });
});

// Seeded sessions ------------------------------------------------------------

/** Every reference the model's bodies can hold, both sides' answers to each; the first that differ, in words, or null. */
function referenceDifference(bodies: readonly NamedBody[], names: DesignNames, r: BooleanRebuild, blocks: Map<string, { edges: (string | null)[] }>, count: { faces: number; edges: number; old: number; ambiguous: number; oldAmbiguous: number }): string | null {
  const modelFace = (f: ReturnType<typeof resolveFace>) => ("lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${f.body} ${f.found.full} ${f.warning ?? ""}`);
  const modelEdge = (f: ReturnType<typeof resolveEdge>) => ("lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${f.body} ${f.found.faces.join("+")};${f.found.ends.join(",")}`);
  const faceNames = new Set(r.bodies.flatMap((b) => b.faces.flatMap((f) => f.names)));
  for (const name of faceNames) {
    const pieces = r.bodies.flatMap((b) => b.faces.filter((f) => f.names.includes(name)));
    const centre = (rect: (typeof pieces)[number]["rects"][number]) => rect[0].map((x, i) => (x + rect[1][i]) / 2) as [number, number, number];
    const origins = pieces.flatMap((f) => [centre(f.rects[0]), f.low as [number, number, number]]);
    origins.push(origins.filter((_, i) => i % 2 === 0).reduce((s, p) => s.map((x, i) => x + p[i] / pieces.length), [0, 0, 0]) as [number, number, number]);
    const refs = [{ name }, ...origins.map((origin) => ({ name, origin })), ...pieces.map((f) => ({ name, tag: r.tagFor(f, name) })), { name, tag: ["face:nowhere/end"] }];
    for (const ref of refs) {
      const [d, m] = [saidFace(bodies, names, resolveFaceName(bodies, names, ref)), modelFace(resolveFace(r, ref))];
      count.faces++;
      if (d.startsWith("ambiguous")) count.ambiguous++;
      if (d !== m) return `face reference ${JSON.stringify(ref)}: Design ${d}, model ${m}`;
    }
  }
  for (const b of r.bodies)
    for (const e of b.edges) {
      const pair = `edge:${e.faces.join("+")}`;
      for (const name of [e.name, pair, `${pair};ends:${e.ends.join(",")}`, `${pair};ends:face:nowhere/end`]) {
        if (name === null) continue;
        const [d, m] = [saidEdge(bodies, names, resolveEdgeName(names, name)), modelEdge(resolveEdge(r, name))];
        count.edges++;
        if (d !== m) return `edge reference ${name}: Design ${d}, model ${m}`;
      }
    }
  for (const [feature, built] of blocks)
    for (const part of built.edges) {
      if (part === null) continue;
      const id = `edge:${feature}/${part}`;
      const q = readOldEdge(feature, part, "reference")!;
      const found = findOldEdgeAfterBooleans(r, q);
      const m = typeof found === "string" ? (found === "lost" ? "lost" : "ambiguous") : `${found.body} ${found.name}`;
      const df = resolveOldEdge(bodies, ...oldEdgeFaces(edgeRef(id))!);
      const d = "lost" in df ? "lost" : "ambiguous" in df ? "ambiguous" : `${bodies[df.body].id} ${names.edges[df.body][df.index]!.name}`;
      count.old++;
      if (d === "ambiguous") count.oldAmbiguous++;
      if (d !== m) return `old edge ${id}: Design ${d}, model ${m}`;
    }
  return null;
}

test(`seeded blocks and Combines: Design names every edge and answers every reference as the model does (${SEEDS.length} seeds)`, async () => {
  const count = { faces: 0, edges: 0, old: 0, ambiguous: 0, oldAmbiguous: 0, ends: 0, shared: 0 };
  for (const seed of SEEDS) {
    const features = randomSession(seed);
    const { bodies, blocks } = await designRebuild(features);
    const names = designNames(bodies);
    const r = rebuildBooleans(features);
    const replay = `seed ${seed} (FISSION_SEED=${seed} replays it)`;
    assert.equal(edgeDifference(designEdges(bodies, names), modelEdges(r)), null, `${replay}: ${edgeDifference(designEdges(bodies, names), modelEdges(r))}`);
    const why = referenceDifference(bodies, names, r, blocks, count);
    assert.equal(why, null, `${replay}: ${why}`);
    count.ends += names.edges.flat().filter((e) => e?.name?.includes(";ends:")).length;
    count.shared += names.edges.flat().filter((e) => e !== null && e.name === null).length;
  }
  // The sessions must reach the cases they test: pairs meeting twice, and ambiguous references.
  if (SEEDS.length >= 200) {
    assert.ok(count.ends >= 10, `only ${count.ends} edges between faces meeting twice`);
    assert.ok(count.shared >= 10, `only ${count.shared} shared edges`);
    assert.ok(count.ambiguous >= 10, `only ${count.ambiguous} ambiguous face references`);
    assert.ok(count.oldAmbiguous >= 10, `only ${count.oldAmbiguous} ambiguous old edge names`);
  }
  if (process.env.BOOLEAN_NAMES_COUNTS) console.log(count);
});

// Boundaries -----------------------------------------------------------------

test("a face holds an origin within SAME_CORNER of it (0.9×) and not beyond (1.1×), across its edge or off its plane", async () => {
  const { bodies } = await designRebuild([BAR]);
  const view: BodyView = bodies[0].view;
  const top = bodies[0].faces.findIndex((f) => f.names[0] === "face:feature-1/end");
  // The top is z = 10 over x 0–100, y 0–20: (50, 10, 10) inside, its edge
  // x = 100 holds, then just past it in x, and just above it in z.
  assert.ok(faceHolds(view, top, [50, 10, 10]));
  assert.ok(faceHolds(view, top, [100, 10, 10]));
  assert.ok(faceHolds(view, top, [100 + 0.9 * SAME_CORNER, 10, 10]));
  assert.ok(!faceHolds(view, top, [100 + 1.1 * SAME_CORNER, 10, 10]));
  assert.ok(faceHolds(view, top, [50, 10, 10 + 0.9 * SAME_CORNER]));
  assert.ok(!faceHolds(view, top, [50, 10, 10 + 1.1 * SAME_CORNER]));
  // Past a corner diagonally: (100 + d, 20 + d) is d√2 from the corner, so 0.9 × SAME_CORNER/√2 holds, 1.1 × doesn't.
  const d = SAME_CORNER / Math.SQRT2;
  assert.ok(faceHolds(view, top, [100 + 0.9 * d, 20 + 0.9 * d, 10]));
  assert.ok(!faceHolds(view, top, [100 + 1.1 * d, 20 + 1.1 * d, 10]));
});

// Planted bugs ---------------------------------------------------------------

test("planted bugs in what the kernel says are caught: ends dropped, ends read off the wrong edge's corners", async () => {
  const { bodies } = await designRebuild(NOTCHED);
  const names = designNames(bodies);
  const model = modelEdges(rebuildBooleans(NOTCHED));
  // Ends dropped: the two bottom-front edges both plain pair names, so
  // they'd be shared; the comparison must see it.
  const noEnds: DesignNames = { ...names, edges: names.edges.map((b) => b.map((e) => (e === null ? e : { ...e, name: `edge:${e.faces.join("+")}` }))) };
  assert.notEqual(edgeDifference(designEdges(bodies, noEnds), model), null);
  // A view whose edge_vertices point at another edge's corners gives the wrong ends.
  const shifted = bodies.map((b) => ({ ...b, view: { ...b.view, edge_vertices: b.view.edge_vertices.map((_, e, all) => all[(e + 1) % all.length]) } }));
  assert.notEqual(edgeDifference(designEdges(shifted, designNames(shifted)), model), null);
});
