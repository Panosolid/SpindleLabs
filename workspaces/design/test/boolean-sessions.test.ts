// Step 35ed2: step 34a5's seeded sessions (packages/testing
// boolean-naming-session.ts `randomBooleanSession`) on Design on the real
// kernel through the test-only Combine (boolean-combine.ts), in "kernel
// form" (`kernelForm`: Extrude join and cut blocks become a new block and a
// Combine, every block shrunk inward by (place + 1)/64 mm so no two inputs
// share a plane until 36a), checked at every step against the exact naming
// model: bodies, volumes, faces' names, edges' names, which features failed,
// and every reference the session made so far (faces by name with or
// without a tag and an origin, edges by name) found the same way. Hand-
// worked cases first, then the sessions (BOOLEAN_KERNEL_SESSIONS, 40 by
// default; FISSION_SEED replays one), the guard's boundary and planted bugs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOLEAN_FAULTS, LINEAR, rebuildBooleans, resolveEdge, resolveFace, type BlockFeature, type BooleanFault, type BooleanFeature, type BooleanRebuild } from "../../../packages/testing/src/boolean-naming-model.ts";
import { closePlanes, kernelForm, randomBooleanSession, shrunk, type BooleanSession, type SessionReference } from "../../../packages/testing/src/boolean-naming-session.ts";
import { designNames, resolveEdgeName, resolveFaceName, type NamedBody } from "../src/boolean-names.ts";
import { block, designEdges, designRebuild, designSaid, difference, edgeDifference, modelEdges, modelSays, onKernel, saidEdge, saidFace, type Built, type Run } from "./boolean-combine.ts";

const STEPS = 10;
const SESSIONS = process.env.FISSION_SEED !== undefined ? [BigInt(process.env.FISSION_SEED)] : [...Array(Number(process.env.BOOLEAN_KERNEL_SESSIONS ?? 40)).keys()].map(BigInt);
const COMBINE_REFUSED = "faces lying on each other are not supported yet";

// Kernel form by hand ---------------------------------------------------------

test("kernel form by hand: an Extrude cut listing two bodies is its block shrunk by (place + 1)/64 and one Combine per body", () => {
  // The cut is the session's third feature (place 2), so k = 3: every side
  // moves in by 3/64 = 0.046875 mm, exact in binary: x 3 → 3.046875 and
  // 4 → 3.953125, y −1 → −0.953125 and 9 → 8.953125, z the same.
  const cut: BlockFeature = { kind: "block", id: "feature-3", rect: [3, -1, 4, 9], z: [-1, 7], operation: "cut", bodies: ["body:feature-1", "body:feature-2"] };
  assert.deepEqual(kernelForm(cut, 2), [
    { kind: "block", id: "feature-3", rect: [3.046875, -0.953125, 3.953125, 8.953125], z: [-0.953125, 6.953125], operation: "new" },
    // The first body cut keeps the tool for the next; the last uses it up.
    { kind: "combine", id: "feature-3-cut-1", target: "body:feature-1", tools: ["body:feature-3"], operation: "cut", keepTools: true },
    { kind: "combine", id: "feature-3-cut-2", target: "body:feature-2", tools: ["body:feature-3"], operation: "cut", keepTools: false },
  ]);
  // An Extrude join at place 0 (k = 1): one Combine, the first listed body the target, the others and the block its tools.
  const join: BlockFeature = { kind: "block", id: "feature-1", rect: [0, 0, 1, 1], z: [0, 1], operation: "join", bodies: ["body:b", "body:a"] };
  assert.deepEqual(kernelForm(join, 0)[1], { kind: "combine", id: "feature-1-join", target: "body:b", tools: ["body:a", "body:feature-1"], operation: "join" });
  assert.deepEqual((kernelForm(join, 0)[0] as BlockFeature).rect, [1 / 64, 1 / 64, 63 / 64, 63 / 64]);
  // A Combine is left as it is.
  const combine: BooleanFeature = { kind: "combine", id: "feature-9", target: "body:a", tools: ["body:b"], operation: "intersect", keepTools: true };
  assert.deepEqual(kernelForm(combine, 8), [combine]);
});

test("a slot cut from two bars in kernel form on the real kernel, by hand: each bar's far piece keeps its id, the tool used up", async () => {
  // Bar 1 (place 0, k = 1): x 1/64 to 8 − 1/64, y 1/64 to 2 − 1/64, z 1/64 to 1 − 1/64.
  // Bar 2 (place 1, k = 2): x 2/64 to 8 − 2/64, y 4 + 2/64 to 6 − 2/64, z 2/64 to 1 − 2/64.
  // The slot (place 2, k = 3): x 3 + 3/64 to 4 − 3/64, right through in y and z.
  const session: BooleanFeature[] = [
    ...kernelForm(block("feature-1", [0, 0, 8, 2], [0, 1]), 0),
    ...kernelForm(block("feature-2", [0, 4, 8, 6], [0, 1]), 1),
    ...kernelForm({ kind: "block", id: "feature-3", rect: [3, -1, 4, 9], z: [-1, 7], operation: "cut", bodies: ["body:feature-1", "body:feature-2"] }, 2),
  ];
  const { bodies, failed } = await designRebuild(session);
  assert.deepEqual([...failed], []);
  // Rule 1: walking each bar's faces in made order (start, end, then the
  // sides by line), start, end and line 1's side run the whole length and
  // are split; line 2's side (x = 8 − k/64) is the first wholly in one
  // piece, the far one, which keeps the bar's id; the near piece is the
  // Combine's piece 1. The slot's body is used up by the second Combine.
  const said = designSaid(bodies, failed);
  assert.deepEqual(said.bodies.map((b) => b.id), ["body:feature-1", "body:feature-2", "body:feature-3-cut-1/piece:1", "body:feature-3-cut-2/piece:1"]);
  // Volumes: bar 1's section is (2 − 2/64) × (1 − 2/64) = 126/64 × 62/64;
  // its far piece runs x 4 − 3/64 to 8 − 1/64, 4 + 2/64 = 258/64 long, its
  // near piece 1/64 to 3 + 3/64, 194/64. Bar 2's section (2 − 4/64) ×
  // (1 − 4/64) = 124/64 × 60/64; far piece 4 − 3/64 to 8 − 2/64, 257/64;
  // near piece 2/64 to 3 + 3/64, 193/64.
  const v = (a: number, b: number, c: number) => (a * b * c) / 64 ** 3;
  const close = (id: string, want: number) => {
    const got = said.bodies.find((b) => b.id === id)!.volume;
    assert.ok(Math.abs(got - want) <= 1e-9 * want, `${id}: ${got}, by hand ${want}`);
  };
  close("body:feature-1", v(258, 126, 62));
  close("body:feature-3-cut-1/piece:1", v(194, 126, 62));
  close("body:feature-2", v(257, 124, 60));
  close("body:feature-3-cut-2/piece:1", v(193, 124, 60));
  // The model says the same of every body, face and edge.
  assert.equal(difference(said, modelSays(session)), null);
  assert.equal(edgeDifference(designEdges(bodies, designNames(bodies)), modelEdges(rebuildBooleans(session))), null);
});

// The guard ----------------------------------------------------------------------

test("the guard: blocks' planes 0.9 × 1/64 mm apart are flagged, 1.1 × apart are not, and a block's own sides never count", () => {
  const at = (x: number) => [block("feature-1", [0, 0, 1, 1], [0, 1]), block("feature-2", [1 + x, 0.5, 2, 2], [0.25, 2])];
  assert.match(closePlanes(at(0.9 / 64)) ?? "", /^feature-1 and feature-2: x 1 and 1\.0140625$/);
  assert.equal(closePlanes(at(1.1 / 64)), null);
  // Shared planes (x = 1 and y 0 to 0) are flagged; a thin block alone is not.
  assert.notEqual(closePlanes([block("feature-1", [0, 0, 1, 1], [0, 1]), block("feature-2", [1, 2, 3, 3], [2, 3])]), null);
  assert.equal(closePlanes([block("feature-1", [0, 0, 0.001, 1], [0, 1])]), null);
});

test("shrinking is what keeps the planes apart: plain sessions share planes, the same sessions in kernel form never come within 1/64 mm", () => {
  let shared = 0;
  for (let seed = 0n; seed < 40n; seed++) {
    if (closePlanes(randomBooleanSession(seed, STEPS).features) !== null) shared++;
    const s = randomBooleanSession(seed, STEPS, "kernel");
    assert.equal(closePlanes(s.features), null, `seed ${seed}`);
    assert.ok(s.features.every((f) => f.kind === "combine" || f.operation === "new"), `seed ${seed}: only new blocks and Combines`);
  }
  assert.ok(shared > 30, `only ${shared} of 40 plain sessions share a plane`);
  // Shrinking by the same k twice would put two blocks' planes together again.
  const a = block("feature-1", [0, 0, 2, 2], [0, 2]);
  const b = block("feature-2", [2, 0, 4, 2], [0, 2]);
  assert.notEqual(closePlanes([shrunk(a, 1), shrunk(b, 1)]), null);
  assert.equal(closePlanes([shrunk(a, 1), shrunk(b, 2)]), null);
});

// The sessions ----------------------------------------------------------------------

/** A found face or edge as the model says it, the same words as `saidFace` and `saidEdge`. */
function modelFinds(r: BooleanRebuild, ref: SessionReference, faults: readonly BooleanFault[]): string {
  if (ref.kind === "edge") {
    const f = resolveEdge(r, ref.name);
    return "lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${f.body} ${f.found.faces.join("+")};${f.found.ends.join(",")}`;
  }
  const f = resolveFace(r, ref, faults);
  return "lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${f.body} ${f.found.full} ${f.warning ?? ""}`;
}

function designFinds(bodies: readonly NamedBody[], names: ReturnType<typeof designNames>, ref: SessionReference): string {
  if (ref.kind === "edge") return saidEdge(bodies, names, resolveEdgeName(names, ref.name));
  return saidFace(bodies, names, resolveFaceName(bodies, names, ref));
}

/**
 * Whether the model's inputs to a Combine have faces lying on each other:
 * a face of the target and one of a tool on one plane (within LINEAR),
 * overlapping in an area. The kernel refuses those until 36a.
 */
function facesLieOnEachOther(r: BooleanRebuild, target: string, tools: readonly string[]): boolean {
  const faces = (id: string) => r.bodies.find((b) => b.id === id)?.faces ?? [];
  const axis = (f: { facing: string }) => "xyz".indexOf(f.facing[1]);
  for (const f of faces(target))
    for (const g of tools.flatMap(faces)) {
      if (axis(f) !== axis(g) || Math.abs(f.at - g.at) > LINEAR) continue;
      const others = [0, 1, 2].filter((a) => a !== axis(f));
      if (f.rects.some((p) => g.rects.some((q) => others.every((a) => Math.min(p[1][a], q[1][a]) - Math.max(p[0][a], q[0][a]) > LINEAR)))) return true;
    }
  return false;
}

test("faces lying on each other by hand: two bars cut by one slab both end on its wall, a far and a near piece do not", async () => {
  // Bar 1 x 0–4 y 0–1, bar 2 x 1–5 y 0.5–3 (z both 0–1), the slab x 2–3 right through cutting
  // both, kept after the first: each keeps a far piece ending on the slab's x = 3 wall, facing −x.
  const slab = block("feature-3", [2, -1, 3, 9], [-1, 7]);
  const timeline: BooleanFeature[] = [
    block("feature-1", [0, 0, 4, 1], [0, 1]),
    block("feature-2", [1, 0.5, 5, 3], [0, 1]),
    slab,
    { kind: "combine", id: "feature-4", target: "body:feature-1", tools: ["body:feature-3"], operation: "cut", keepTools: true },
    { kind: "combine", id: "feature-5", target: "body:feature-2", tools: ["body:feature-3"], operation: "cut" },
  ];
  // The far pieces overlap in y 0.5–1 on x = 3: they lie on each other.
  assert.equal(facesLieOnEachOther(rebuildBooleans(timeline), "body:feature-1", ["body:feature-2"]), true);
  // The near pieces end on x = 2 facing +x and overlap too; but bar 1's far piece against bar 2's near one share no plane.
  assert.equal(facesLieOnEachOther(rebuildBooleans(timeline), "body:feature-4/piece:1", ["body:feature-5/piece:1"]), true);
  assert.equal(facesLieOnEachOther(rebuildBooleans(timeline), "body:feature-1", ["body:feature-5/piece:1"]), false);
  // And on the real kernel the first is refused in the words the sessions stop on.
  const { why } = await designRebuild([...timeline, { kind: "combine", id: "feature-6", target: "body:feature-1", tools: ["body:feature-2"], operation: "cut" }]);
  assert.match(why.get("feature-6") ?? "", new RegExp(COMBINE_REFUSED));
});

interface Reach {
  sessions: number;
  steps: number;
  /** Sessions stopped where the kernel refused faces lying on each other (until 36a), and the model said they do. */
  stopped36a: number;
  pieces: number;
  tagged: number;
  keptTools: number;
  failed: Map<string, number>;
  references: Map<string, number>;
  ends: number;
  shared: number;
}

/**
 * Step `done` of a session on Design (`built`) against the model with
 * `faults` planted: where they part, in words; "stop" where the kernel
 * refused faces lying on each other, the model built the Combine and its
 * inputs do lie on each other (36a makes it build: the comparison ends
 * there); or null.
 */
function stepDifference(s: BooleanSession, done: number, built: Built, faults: readonly BooleanFault[]): string | "stop" | null {
  const timeline = s.features.slice(0, done);
  const f = timeline[done - 1];
  const model = rebuildBooleans(timeline, faults);
  const refused = built.why.get(f.id);
  if (f.kind === "combine" && refused?.includes(COMBINE_REFUSED) && !model.failed.has(f.id))
    return facesLieOnEachOther(rebuildBooleans(timeline.slice(0, -1), faults), f.target, f.tools) ? "stop" : `the kernel refused "${refused}", the model's inputs do not lie on each other`;
  const d = difference(designSaid(built.bodies, built.failed), modelSays(model));
  if (d !== null) return d;
  const names = designNames(built.bodies);
  const e = edgeDifference(designEdges(built.bodies, names), modelEdges(model));
  if (e !== null) return e;
  for (const { after, ref } of s.references) {
    if (after >= done) continue;
    const [dd, m] = [designFinds(built.bodies, names, ref), modelFinds(model, ref, faults)];
    if (dd !== m) return `${ref.kind} reference ${JSON.stringify(ref)}: Design ${dd}, model ${m}`;
  }
  return null;
}

/**
 * One session step by step on Design, built once, against the model with
 * each of `faultSets` planted: for each, the first place they part, in
 * words, or null. `reach` counts what the first set's comparison reached.
 */
async function sessionDifferences(s: BooleanSession, reach: Reach, faultSets: readonly (readonly BooleanFault[])[] = [[]], run: Run = onKernel): Promise<(string | null)[]> {
  const why: (string | null)[] = faultSets.map(() => null);
  const stopped = faultSets.map(() => false);
  const step = (done: number, built: Built) => {
    faultSets.forEach((faults, i) => {
      if (why[i] !== null || stopped[i]) return;
      const d = stepDifference(s, done, built, faults);
      if (d === "stop") {
        stopped[i] = true;
        if (i === 0) reach.stopped36a++;
      } else if (d !== null) why[i] = `seed ${s.seed} (FISSION_SEED=${s.seed} replays it), step ${done} (${s.features[done - 1].id}): ${d}`;
    });
    if (why[0] !== null || stopped[0]) return;
    const f = s.features[done - 1];
    reach.steps++;
    if (f.kind === "combine" && f.keepTools && !built.failed.has(f.id)) reach.keptTools++;
    if (built.failed.has(f.id)) {
      const words = (built.why.get(f.id) ?? "").replace(/face \d+|tool \d+/g, "…").slice(0, 60);
      reach.failed.set(words, (reach.failed.get(words) ?? 0) + 1);
    }
    if (done < s.features.length) return;
    // At the end: what the session made, and how every reference it made fares.
    const names = designNames(built.bodies);
    reach.pieces += built.bodies.filter((b) => b.id.includes("/piece:")).length;
    reach.tagged += designSaid(built.bodies, built.failed).bodies.flatMap((b) => b.faces).filter((x) => x.includes("#")).length;
    reach.ends += names.edges.flat().filter((x) => x?.name?.includes(";ends:")).length;
    reach.shared += names.edges.flat().filter((x) => x !== null && x.name === null).length;
    for (const { ref } of s.references) {
      const found = designFinds(built.bodies, names, ref);
      const outcome = found === "lost" ? "lost" : found.startsWith("ambiguous") ? "ambiguous" : found.endsWith("split") ? "found, warned split" : "found";
      reach.references.set(`${ref.kind} ${outcome}`, (reach.references.get(`${ref.kind} ${outcome}`) ?? 0) + 1);
    }
  };
  await designRebuild(s.features, run, step);
  reach.sessions++;
  return why;
}

const newReach = (): Reach => ({ sessions: 0, steps: 0, stopped36a: 0, pieces: 0, tagged: 0, keptTools: 0, failed: new Map(), references: new Map(), ends: 0, shared: 0 });

test(`${SESSIONS.length} seeded sessions of ${STEPS} features in kernel form: Design on the real kernel names, finds and refuses as the model does at every step`, async () => {
  const reach = newReach();
  for (const seed of SESSIONS) {
    const [why] = await sessionDifferences(randomBooleanSession(seed, STEPS, "kernel"), reach);
    assert.equal(why, null, why ?? "");
  }
  const count = (prefix: string) => [...reach.references].filter(([k]) => k.startsWith(prefix)).reduce((s, [, n]) => s + n, 0);
  console.log(
    `${reach.sessions} sessions, ${reach.steps} steps compared, ${reach.stopped36a} stopped at faces lying on each other (36a); ${reach.pieces} pieces, ${reach.tagged} tagged faces, ${reach.ends} edges told apart by their ends, ${reach.shared} shared edges, ${reach.keptTools} Combines keeping their tools`,
  );
  console.log(`references: ${[...reach.references].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`failed: ${[...reach.failed].map(([k, n]) => `${n}× ${k}`).join("; ")}`);
  // The sessions must reach what they test, and the 36a stops must stay few, or the comparison would quietly shrink.
  if (SESSIONS.length >= 40) {
    assert.ok(reach.stopped36a <= SESSIONS.length / 8, `${reach.stopped36a} sessions stopped at faces lying on each other`);
    assert.ok(reach.steps >= SESSIONS.length * 8, `only ${reach.steps} steps compared`);
    assert.ok(reach.pieces >= 20, `only ${reach.pieces} pieces`);
    assert.ok(reach.tagged >= 20, `only ${reach.tagged} tagged faces`);
    assert.ok(reach.keptTools >= 5, `only ${reach.keptTools} Combines keeping their tools`);
    assert.ok(count("face found, warned split") >= 5, "too few face references warned of a split");
    assert.ok(count("face ambiguous") + count("face lost") >= 5, "too few face references ambiguous or lost");
    assert.ok(count("edge found") >= 20, "too few edge references found");
    assert.ok(count("edge lost") + count("edge ambiguous") >= 5, "too few edge references lost or ambiguous");
    assert.ok(reach.failed.size >= 3, `features failed for only ${reach.failed.size} reasons`);
  }
});

// Planted bugs --------------------------------------------------------------------------

test("planted bugs are caught by the sessions: each naming rule's fault in the model, and Design's Combine swapping its target and tool", async () => {
  // Out of reach here, and shown to be: the faults on Extrude join and cut
  // alone (kernel form has none), pinches and rule 4's merges (kernel form
  // keeps every plane apart, so nothing touches along an edge and no faces
  // merge until 36a).
  const unreachable: BooleanFault[] = ["number-per-body", "join-latest", "merge-tool-first", "merge-one-name", "pinch-allowed"];
  const caught = new Set<BooleanFault>();
  for (let seed = 0n; seed < 40n; seed++) {
    // The out-of-reach ones on the first 10 seeds only (the model's own sessions catch them), to keep this quick.
    const left = BOOLEAN_FAULTS.filter((f) => !caught.has(f) && (seed < 10n || !unreachable.includes(f)));
    if (left.length === 0) break;
    const whys = await sessionDifferences(randomBooleanSession(seed, STEPS, "kernel"), newReach(), left.map((f) => [f]));
    left.forEach((f, i) => whys[i] !== null && caught.add(f));
  }
  assert.deepEqual(BOOLEAN_FAULTS.filter((f) => !caught.has(f)), unreachable);
  // Design's Combine handing the kernel the target and the first tool the wrong way round.
  const swapped: Run = async (target, tools, op) => onKernel(tools[0], [target, ...tools.slice(1)], op);
  let found = false;
  for (let seed = 0n; seed < 40n && !found; seed++) found = (await sessionDifferences(randomBooleanSession(seed, STEPS, "kernel"), newReach(), [[]], swapped))[0] !== null;
  assert.ok(found, "a Combine with its target and tool swapped was not caught");
});
