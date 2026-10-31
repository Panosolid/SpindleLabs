// Step 35ec2: names on the real kernel's boolean results (boolean-names.ts)
// through a test-only Combine (no button until 35f), checked against the
// exact naming model (packages/testing boolean-naming-model.ts): hand-worked
// cases first, then seeded blocks and Combines (BOOLEAN_NAMES_SEEDS, 20 by
// default; FISSION_SEED replays one), then the boundaries and planted bugs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelError, type BodyView, type BooleanOp, type BooleanResult, type KernelCalls } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { seeded } from "../../../packages/testing/src/index.ts";
import { rebuildBooleans, type BlockFeature, type BooleanFeature } from "../../../packages/testing/src/boolean-naming-model.ts";
import { featureNames } from "../src/naming.ts";
import { plainOutline } from "../src/sketch.ts";
import { combineNames, cornerCompare, featureBody, fullNames, sizeCompare, SAME_CORNER, TIE, type NamedBody } from "../src/boolean-names.ts";

const kernel: KernelCalls = nodeKernel();
const OPS: Record<"join" | "cut" | "intersect", BooleanOp> = { join: "union", cut: "subtract", intersect: "intersect" };

/** A block as Design builds it: a rectangle of four lines (line-1 along −y, then round counter-clockwise) extruded on XY from z0. */
async function buildBlock(f: BlockFeature, place: number): Promise<NamedBody> {
  const [x0, y0, x1, y1] = f.rect;
  const c: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const lines = c.map((a, i) => ({ a, b: c[(i + 1) % 4] }));
  const out = plainOutline(await kernel.call("sketch_outline", lines, [], []));
  assert.ok("closed" in out, "a block's rectangle closes");
  const profile = out.closed;
  const spec = { extrude: { profile, distance: f.z[1] - f.z[0], frame: { origin: [0, 0, f.z[0]] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] } } };
  const handle = await kernel.call("body_build", spec);
  const view = await kernel.call("body_view", handle);
  const ids = f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
  const names = featureNames(f.id, { spec, curves: { line: [...ids], arc: [], circle: [] } }, view);
  return featureBody(`body:${f.id}`, handle, view, names, place);
}

/** What `Combine` runs in combineNames: the kernel's boolean and each result body's view. */
type Run = (target: NamedBody, tools: readonly NamedBody[], op: BooleanOp) => Promise<{ result: BooleanResult; views: BodyView[] }>;
const onKernel: Run = async (target, tools, op) => {
  const result = await kernel.call("body_boolean", target.handle, tools.map((t) => t.handle), op);
  return { result, views: await Promise.all(result.bodies.map((h) => kernel.call("body_view", h))) };
};

/** The test-only Combine: every feature in order on the real kernel, named by boolean-names.ts; a refusal fails the feature and keeps its bodies. */
async function designRebuild(features: readonly BooleanFeature[], run: Run = onKernel): Promise<{ bodies: NamedBody[]; failed: Set<string> }> {
  let bodies: NamedBody[] = [];
  const failed = new Set<string>();
  for (const [place, f] of features.entries()) {
    if (f.kind === "block") {
      assert.equal(f.operation, "new", "the test-only Combine builds new blocks only (Extrude join and cut are step 39)");
      bodies.push(await buildBlock(f, place));
      continue;
    }
    const target = bodies.find((b) => b.id === f.target)!;
    const tools = f.tools.map((id) => bodies.find((b) => b.id === id)!);
    try {
      const { result, views } = await run(target, tools, OPS[f.operation]);
      const named = combineNames(f.id, OPS[f.operation], target, tools, result, views);
      if ("failed" in named) throw new Error(named.failed);
      bodies = bodies.flatMap((b) => (b === target ? named.bodies : !f.keepTools && tools.includes(b) ? [] : [b]));
    } catch (e) {
      if (!(e instanceof KernelError) || e.kind !== "invalid-input") throw e;
      failed.add(f.id);
    }
  }
  return { bodies, failed };
}

/** Each body as both sides can say it: its id, volume, and its faces' names (shown first) with the full name. */
interface Said {
  id: string;
  volume: number;
  faces: string[];
}

async function designSays(features: readonly BooleanFeature[], run?: Run): Promise<{ bodies: Said[]; failed: string[] }> {
  const { bodies, failed } = await designRebuild(features, run);
  const full = fullNames(bodies);
  const said = bodies.map((b, bi) => ({ id: b.id, volume: b.view.volume, faces: b.faces.map((f, fi) => `${full[bi][fi]} = ${f.names.join(" | ")}`).sort() }));
  return { bodies: said.sort((a, b) => (a.id < b.id ? -1 : 1)), failed: [...failed].sort() };
}

function modelSays(features: readonly BooleanFeature[]): { bodies: Said[]; failed: string[] } {
  const r = rebuildBooleans(features);
  const said = r.bodies.map((b) => ({ id: b.id, volume: b.volume, faces: b.faces.map((f) => `${f.full} = ${f.names.join(" | ")}`).sort() }));
  return { bodies: said.sort((a, b) => (a.id < b.id ? -1 : 1)), failed: [...r.failed.keys()].sort() };
}

/** Where Design and the model part, in words; null when they agree (volumes within a billionth). */
function difference(d: { bodies: Said[]; failed: string[] }, m: { bodies: Said[]; failed: string[] }): string | null {
  if (d.failed.join() !== m.failed.join()) return `failed: Design ${d.failed.join() || "none"}, model ${m.failed.join() || "none"}`;
  if (d.bodies.map((b) => b.id).join() !== m.bodies.map((b) => b.id).join()) return `bodies: Design ${d.bodies.map((b) => b.id).join()}, model ${m.bodies.map((b) => b.id).join()}`;
  for (const [i, b] of d.bodies.entries()) {
    const n = m.bodies[i];
    if (Math.abs(b.volume - n.volume) > 1e-9 * Math.max(b.volume, n.volume)) return `${b.id} volume: Design ${b.volume}, model ${n.volume}`;
    const extra = b.faces.filter((f) => !n.faces.includes(f));
    const missing = n.faces.filter((f) => !b.faces.includes(f));
    if (extra.length + missing.length > 0) return `${b.id} faces: only Design ${extra.join("; ") || "none"}; only model ${missing.join("; ") || "none"}`;
  }
  return null;
}

const block = (id: string, rect: BlockFeature["rect"], z: BlockFeature["z"]): BlockFeature => ({ kind: "block", id, rect, z, operation: "new" });

// The F1 bar (Ben's Fusion check): 100 × 20 × 10, cut by a slot at x 30–40
// going right through (y −1 to 21, z −1 to 11: the kernel refuses faces
// lying on each other until 36a, so the slot pokes out).
const BAR = block("feature-1", [0, 0, 100, 20], [0, 10]);
const SLOT = block("feature-2", [30, -1, 40, 21], [-1, 11]);
const F1: BooleanFeature[] = [BAR, SLOT, { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "cut" }];

test("F1 by hand: the far piece of the bar keeps Body1, the near one is piece 1, the split faces tagged by their walls", async () => {
  // Rule 1's walk, the bar's faces in made order: the start cap (z = 0) and
  // the end cap (z = 10) are each split across both pieces, so is line 1's
  // side (y = 0); line 2's side (x = 100) is the first face left wholly in
  // one piece, the far piece x 40–100, which keeps body:feature-1 though it
  // is 60 × 20 × 10 = 12000 mm³ and the near one 30 × 20 × 10 = 6000 mm³.
  const { bodies } = await designRebuild(F1);
  assert.deepEqual(bodies.map((b) => [b.id, b.view.volume, b.view.bounds[0][0]]), [
    ["body:feature-1", 12000, 40],
    ["body:feature-3/piece:1", 6000, 0],
  ]);
  // Rule 3: the near top piece borders the bar's x = 0 side (line 4) and the
  // slot's x = 30 wall (its line 4) that the far top doesn't; the far top
  // the bar's x = 100 side (line 2) and the slot's x = 40 wall (line 2).
  const full = fullNames(bodies);
  const top = (b: number) => full[b][bodies[b].faces.findIndex((f) => f.names[0] === "face:feature-1/end")];
  assert.equal(top(0), "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2");
  assert.equal(top(1), "face:feature-1/end#face:feature-1/side:line-4,face:feature-2/side:line-4");
  // Rule 2: the hole's walls keep the slot's names, though the slot is used up.
  assert.ok(bodies[0].faces.some((f) => f.names[0] === "face:feature-2/side:line-2"));
  assert.equal(difference(await designSays(F1), modelSays(F1)), null);
});

test("F2 by hand: a join of two apart blocks keeps the target's id, the tool left apart is a new piece", async () => {
  // A join's target keeps its id whatever (rule 1, Fusion check F2: Body1
  // and a new Body3); the tool block, touching nothing, is
  // body:feature-3/piece:1 with its own faces' names (rule 2).
  const features: BooleanFeature[] = [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [20, 1, 25, 6], [1, 6]), { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "join" }];
  const { bodies } = await designRebuild(features);
  assert.deepEqual(bodies.map((b) => [b.id, b.view.volume]), [["body:feature-1", 1000], ["body:feature-3/piece:1", 125]]);
  assert.ok(bodies[1].faces.every((f) => f.names[0].startsWith("face:feature-2/")));
  assert.equal(difference(await designSays(features), modelSays(features)), null);
});

test("a join where the tool swallows the target whole: the one piece keeps the target's id, every face named by the tool", async () => {
  // Nothing of the target's surface is left, so no face says where it is;
  // the union is one body, and it holds the target: body:feature-1, its
  // faces all the tool's (1 + 12)³ − ... a 12 mm cube from −1, 1728 mm³.
  const features: BooleanFeature[] = [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [-1, -1, 11, 11], [-1, 11]), { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "join" }];
  const { bodies } = await designRebuild(features);
  assert.deepEqual(bodies.map((b) => [b.id, b.view.volume]), [["body:feature-1", 1728]]);
  assert.ok(bodies[0].faces.every((f) => f.names[0].startsWith("face:feature-2/")));
  assert.equal(difference(await designSays(features), modelSays(features)), null);
});

test("a cut into three ranks the pieces by the first face reaching them in made order, not by size or the kernel's order", async () => {
  // After F1, the far piece (x 40–100, y 0–20, z 0–10) is cut by two slabs,
  // z 1–2 and z 8–9, into three: z 0–1 (60 × 20 × 1 = 1200 mm³), z 2–8
  // (7200 mm³) and z 9–10 (1200 mm³). Walking its faces in made order: the
  // bar's start cap (z = 0) lies wholly in the bottom piece, which keeps
  // body:feature-1; the end cap (z = 10), next, reaches the top piece first,
  // so it is piece 1 and the middle one, reached only by the sides after,
  // piece 2, though it is six times the size. (The kernel lists the far
  // piece's faces with line 1's side first, which reaches all three and
  // would make the middle one piece 1: names never follow its order.)
  const features: BooleanFeature[] = [
    ...F1,
    block("feature-4", [39, -1, 101, 21], [1, 2]),
    block("feature-5", [39, -1, 101, 21], [8, 9]),
    { kind: "combine", id: "feature-6", target: "body:feature-1", tools: ["body:feature-4", "body:feature-5"], operation: "cut" },
  ];
  const { bodies } = await designRebuild(features);
  const far = bodies.filter((b) => b.id !== "body:feature-3/piece:1").map((b) => [b.id, b.view.volume, b.view.bounds[0][2]]);
  assert.deepEqual(far, [
    ["body:feature-1", 1200, 0],
    ["body:feature-6/piece:1", 1200, 9],
    ["body:feature-6/piece:2", 7200, 2],
  ]);
  assert.equal(difference(await designSays(features), modelSays(features)), null);
});

test("a join where a tool swallows the target keeps the target's id on that piece, even with a larger tool apart", async () => {
  // The target [0,10]³ is swallowed by a 12 mm cube from −1 (1728 mm³); a
  // second tool, 25 mm cubed (15625 mm³), touches neither. No face of the
  // target is left to say where it is, so the piece holding it (the one
  // whose box holds its box) keeps body:feature-1; the larger lump is piece 1.
  const features: BooleanFeature[] = [
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [-1, -1, 11, 11], [-1, 11]),
    block("feature-3", [20, 0.5, 45, 25.5], [0.5, 25.5]),
    { kind: "combine", id: "feature-4", target: "body:feature-1", tools: ["body:feature-2", "body:feature-3"], operation: "join" },
  ];
  const { bodies } = await designRebuild(features);
  assert.deepEqual(bodies.map((b) => [b.id, b.view.volume]), [["body:feature-1", 1728], ["body:feature-4/piece:1", 15625]]);
  assert.equal(difference(await designSays(features), modelSays(features)), null);
});

test("an intersect keeps the target's id on its one piece, faces named after whichever input they lie on", async () => {
  // Blocks [0,10]³ and [5,15] × [2,12] × [3,13]: their common part is
  // x 5–10, y 2–10, z 3–10, 5 × 8 × 7 = 280 mm³; its x = 5, y = 2 and
  // z = 3 faces lie on the tool's −x, −y and start faces (line 4, line 1,
  // start), the other three on the target's +x, +y and end faces.
  const features: BooleanFeature[] = [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [5, 2, 15, 12], [3, 13]), { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "intersect" }];
  const { bodies } = await designRebuild(features);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].view.volume, 280);
  assert.deepEqual(bodies[0].faces.map((f) => f.names[0]).sort(), [
    "face:feature-1/end",
    "face:feature-1/side:line-2",
    "face:feature-1/side:line-3",
    "face:feature-2/side:line-1",
    "face:feature-2/side:line-4",
    "face:feature-2/start",
  ]);
  assert.equal(difference(await designSays(features), modelSays(features)), null);
});

test("a refused Combine fails and keeps every body as it was, as the model's", async () => {
  // Apart blocks have nothing in common: the kernel refuses the intersect, the model fails it too.
  const features: BooleanFeature[] = [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [20, 1, 25, 6], [1, 6]), { kind: "combine", id: "feature-3", target: "body:feature-1", tools: ["body:feature-2"], operation: "intersect" }];
  const d = await designSays(features);
  assert.deepEqual(d.failed, ["feature-3"]);
  assert.deepEqual(d.bodies.map((b) => b.id), ["body:feature-1", "body:feature-2"]);
  assert.equal(difference(d, modelSays(features)), null);
});

// Seeded sessions ------------------------------------------------------------

/**
 * A seeded session: two to four blocks with every x, y and z plane apart
 * (the kernel refuses faces lying on each other until 36a, and apart
 * planes can't touch along an edge), then one or two Combines picking
 * live bodies by the model's ids, any operation, the last sometimes
 * keeping its tools (an earlier one would leave a body and its copy, whose
 * faces lie on each other, for the next).
 */
function randomSession(seed: bigint): BooleanFeature[] {
  const r = seeded(seed);
  const int = (n: number) => Math.floor(r.next() * n);
  const pool = () => {
    const values = [...Array(40).keys()].map((v) => v * 1.5);
    for (let i = values.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const [xs, ys, zs] = [pool(), pool(), pool()];
  const pair = (p: number[]) => {
    const a = p.pop()!;
    const b = p.pop()!;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const features: BooleanFeature[] = [];
  const blocks = 2 + int(3);
  for (let i = 0; i < blocks; i++) {
    const [x0, x1] = pair(xs);
    const [y0, y1] = pair(ys);
    features.push(block(`feature-${features.length + 1}`, [x0, y0, x1, y1], pair(zs) as [number, number]));
  }
  const combines = 1 + int(2);
  for (let i = 0; i < combines; i++) {
    const live = rebuildBooleans(features).bodies.map((b) => b.id);
    if (live.length < 2) break;
    const target = live.splice(int(live.length), 1)[0];
    const tools = [live.splice(int(live.length), 1)[0]];
    if (live.length > 0 && r.next() < 0.3) tools.push(live.splice(int(live.length), 1)[0]);
    const operation = (["join", "cut", "intersect"] as const)[int(3)];
    features.push({ kind: "combine", id: `feature-${features.length + 1}`, target, tools, operation, ...(r.next() < 0.2 && i === combines - 1 ? { keepTools: true } : {}) });
  }
  return features;
}

const SEEDS = process.env.FISSION_SEED !== undefined ? [BigInt(process.env.FISSION_SEED)] : [...Array(Number(process.env.BOOLEAN_NAMES_SEEDS ?? 20)).keys()].map((i) => 35_200n + BigInt(i));

test(`seeded blocks and Combines: Design on the real kernel names every body and face as the model does (${SEEDS.length} seeds)`, async () => {
  let pieces = 0;
  let tagged = 0;
  for (const seed of SEEDS) {
    const features = randomSession(seed);
    const d = await designSays(features);
    const why = difference(d, modelSays(features));
    assert.equal(why, null, `seed ${seed} (FISSION_SEED=${seed} replays it): ${why}`);
    pieces += d.bodies.filter((b) => b.id.includes("/piece:")).length;
    tagged += d.bodies.flatMap((b) => b.faces).filter((f) => f.includes("#")).length;
  }
  // The sessions must reach the rules they test: pieces made, and faces split into tagged pieces.
  if (SEEDS.length >= 20) {
    assert.ok(pieces > 0, "no seed made a new piece");
    assert.ok(tagged > 0, "no seed split a face");
  }
});

// Boundaries -----------------------------------------------------------------

test("corners within SAME_CORNER (0.9×) count as one and are compared on the next axis; 1.1× apart they differ", () => {
  // a is lower than b in y by 1 mm; their x differ by 0.9 × SAME_CORNER, so
  // x ties and y decides (a first); at 1.1 × the x decides (b first, its x smaller).
  const near = 0.9 * SAME_CORNER;
  const far = 1.1 * SAME_CORNER;
  assert.ok(cornerCompare([near, 0, 0], [0, 1, 0]) < 0);
  assert.ok(cornerCompare([far, 0, 0], [0, 1, 0]) > 0);
  assert.equal(cornerCompare([0, 0, near], [0, 0, 0]), 0);
  assert.ok(cornerCompare([0, 0, far], [0, 0, 0]) > 0);
});

test("sizes within TIE of the larger (0.9×) count as equal; 1.1× apart the larger comes first", () => {
  // 1000 against 1000 (1 + 0.9 × TIE): equal; against 1000 (1 + 1.1 × TIE): the larger first (negative when it is the first).
  assert.equal(sizeCompare(1000, 1000 * (1 + 0.9 * TIE)), 0);
  assert.ok(sizeCompare(1000 * (1 + 1.1 * TIE), 1000) < 0);
  assert.ok(sizeCompare(1000, 1000 * (1 + 1.1 * TIE)) > 0);
  // The model's own example: 3.3 − 1.3 and 6.3 − 4.3 are not one double but are one share.
  assert.notEqual(3.3 - 1.3, 6.3 - 4.3);
  assert.equal(sizeCompare(3.3 - 1.3, 6.3 - 4.3), 0);
});

// Planted bugs ---------------------------------------------------------------

test("planted bugs in what the kernel says are caught: a lost face origin, swapped pieces", async () => {
  // A history pointing a result face at the wrong input face renames it:
  // the comparison with the model must see it.
  const wrongFace: Run = async (t, tools, op) => {
    const r = await onKernel(t, tools, op);
    const h = r.result.history[0];
    const faces = h.faces.map((f, j) => (j === 0 ? { ...f, face: (f.face + 1) % 6 } : f));
    return { ...r, result: { ...r.result, history: [{ ...h, faces }, ...r.result.history.slice(1)] } };
  };
  assert.notEqual(difference(await designSays(F1, wrongFace), modelSays(F1)), null);
  // Results listed the other way round must not change any name (names never depend on the kernel's order).
  const swapped: Run = async (t, tools, op) => {
    const r = await onKernel(t, tools, op);
    return { views: [...r.views].reverse(), result: { bodies: [...r.result.bodies].reverse(), history: [...r.result.history].reverse() } };
  };
  assert.equal(difference(await designSays(F1, swapped), modelSays(F1)), null);
});
