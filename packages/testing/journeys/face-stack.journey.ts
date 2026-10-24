// Stacked face sketches (Ben's idea, 2026-10-24): seeded chains that keep
// building, each prism sketched on a random flat face of one before it
// (caps, sides, slanted faces, discs, faces only micrometres across) and
// extruded a random distance, sometimes flipped, five to eight deep, then
// edited upstream (distances, flips, a corner of the first outline moved).
// Design builds each chain on the real kernel (src/stack-design.ts) and
// after every step it is checked against the exact model
// (src/stack-model.ts): validation, volume, surface area, every face's
// plane, middle and area, every corner, every face sketch's frame, a fresh
// rebuild, save and open, and undo and redo; at the end every step is
// undone and redone. Joins and cut floors wait for booleans in Design
// (Combine, step 35).
//
// FISSION_STACK_SEEDS (40, about 10 s) and FISSION_STACK_FIRST (1) set the
// seeds; the nightly (fuzz/face-stack.ts) runs thousands. A failing
// chain is shrunk (fewest edits, then fewest prisms) and saved in
// test/regressions/stack/ (FISSION_STACK_OUT saves it there instead), which
// replays forever. Bugs planted in Design's own code: planted/model-faults.ts
// `STACK_PLANTS`, run with `planted/run.ts --stack`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { addSketch, BodyCache, drawLine, extrudeSketch, readDesignDocument, rebuildTimeline, shownBodies } from "@fission/design";
import { buildStack, polygonCentroid, twiceArea, type StackChain, type StackPrism } from "../src/stack-model.ts";
import { chainOf, checkStack, runStack, shrinkStack, STACK_FAULTS, StackFailure, type StackFault } from "../src/stack-design.ts";
import { kernel } from "./design-app.ts";

const SEEDS = Number(process.env.FISSION_STACK_SEEDS ?? 40);
const FIRST = BigInt(process.env.FISSION_STACK_FIRST ?? "1");
const REGRESSIONS = new URL("../test/regressions/stack/", import.meta.url);

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// The drawn frames below are rule 8's, worked by hand: on a face looking along +X the
// nearest origin plane is YZ (normal +X, x axis +Y); on one looking along ±Z it is XY,
// with the normal +Z and the side −1 on a face looking down. The `drawn` record only
// keeps what frameNow reads (the outward normal, x and normal as drawn).
const XY_UP = { outward: [0, 0, 1] as const, x: [1, 0, 0] as const, normal: [0, 0, 1] as const, origin: [0, 0, 10] as const, centroid: [0, 0] as const };
const XY_DOWN = { outward: [0, 0, -1] as const, x: [1, 0, 0] as const, normal: [0, 0, 1] as const, origin: [0, 0, 0] as const, centroid: [0, 0] as const };
const YZ_OUT = (x: number) => ({ outward: [1, 0, 0] as const, x: [0, 1, 0] as const, normal: [1, 0, 0] as const, origin: [x, 0, 0] as const, centroid: [0, 0] as const });

/** Ben's kind of chain, small enough to work by hand: a 20 mm square block with a cylinder on top, a block on its +X side, one under it, and a triangle flipped back into the side block. */
const HAND: StackPrism[] = [
  { on: null, shape: { kind: "polygon", corners: square(0, 0, 20, 20) }, distance: 10, flip: false },
  { on: { prism: 0, face: { role: "end" }, drawn: XY_UP, side: 1 }, shape: { kind: "circle", centre: [10, 10], radius: 5 }, distance: 4, flip: false },
  // Side edge 1 runs (20, 0) → (20, 20): the face x = 20, looking along +X. Sketch (u, v) is world (y, z) there.
  { on: { prism: 0, face: { role: "side", edge: 1 }, drawn: YZ_OUT(20), side: 1 }, shape: { kind: "polygon", corners: square(5, 2, 15, 8) }, distance: 3, flip: false },
  { on: { prism: 0, face: { role: "start" }, drawn: XY_DOWN, side: -1 }, shape: { kind: "polygon", corners: square(2, 2, 6, 4) }, distance: 5, flip: false },
  { on: { prism: 2, face: { role: "end" }, drawn: YZ_OUT(23), side: 1 }, shape: { kind: "polygon", corners: [[6, 3], [14, 3], [10, 7]] }, distance: 2, flip: true },
];

test("hand-worked: the model's numbers for a five-prism chain, and Design's the same", async () => {
  const m = buildStack(HAND);
  // Block: 20 × 20 × 10 = 4000; surface 2·400 + 80·10 = 1600; middle (10, 10, 5).
  // Cylinder on top (z = 10 up): π·5²·4 = 100π; surface 2·25π + 10π·4 = 90π; middle (10, 10, 12).
  // Side block on x = 20, y 5..15, z 2..8, out to x = 23: 10·6·3 = 180; 2·60 + 32·3 = 216; middle (21.5, 10, 5).
  // Under it (the start cap, looking down; extruded the way the sketch faces, −Z): 4·2·5 = 40; 2·8 + 12·5 = 76; (4, 3, −2.5).
  // Triangle (6, 3), (14, 3), (10, 7) on x = 23 (u = y, v = z), flipped back to x = 21: area ½·8·4 = 16, so 32;
  // sides 8, √32, √32, so 2·16 + (8 + 8√2)·2 = 48 + 16√2; middle (10, 13/3) at x = 22.
  const want = [
    { volume: 4000, area: 1600, centroid: [10, 10, 5] },
    { volume: 100 * Math.PI, area: 90 * Math.PI, centroid: [10, 10, 12] },
    { volume: 180, area: 216, centroid: [21.5, 10, 5] },
    { volume: 40, area: 76, centroid: [4, 3, -2.5] },
    { volume: 32, area: 48 + 16 * Math.SQRT2, centroid: [22, 10, 13 / 3] },
  ];
  want.forEach((w, i) => {
    assert.ok(Math.abs(m[i].volume - w.volume) < 1e-9 && Math.abs(m[i].area - w.area) < 1e-9, `prism ${i}: ${m[i].volume}, ${m[i].area}`);
    assert.ok(m[i].centroid.every((x, k) => Math.abs(x - w.centroid[k]) < 1e-12), `prism ${i}'s middle ${m[i].centroid}`);
  });
  // The frames: the cylinder's sketch at (0, 0, 10); the side block's at (20, 0, 0) with x along +Y; the one underneath at the origin, side −1.
  assert.deepEqual([m[1].placement.origin, m[2].placement.origin, m[2].placement.x, m[3].placement.side], [[0, 0, 10], [20, 0, 0], [0, 1, 0], -1]);
  // The triangle's tip (10, 7) at x = 23 and x = 21.
  assert.ok(m[4].vertices.some((v) => Math.hypot(v[0] - 23, v[1] - 10, v[2] - 7) < 1e-12) && m[4].vertices.some((v) => Math.hypot(v[0] - 21, v[1] - 10, v[2] - 7) < 1e-12));
  // Then the block made 15 tall: the cylinder rides up 5 to a middle at z = 17; the side faces' planes don't move, so nothing else does.
  const taller = buildStack(HAND.map((p, i) => (i === 0 ? { ...p, distance: 15 } : p)));
  assert.deepEqual(taller[1].centroid, [10, 10, 17]);
  assert.deepEqual(taller[2].centroid, m[2].centroid);
  // Design agrees with all of it, through every check, with the edit, a flip of the block (its top is then z = −15 looking down, and the
  // cylinder's sketch keeps its side, so it grows up into the block from there) and a corner moved (turning the side block with its face).
  const run = await runStack(kernel, { seed: 0n, prisms: HAND, edits: [{ kind: "distance", prism: 0, distance: 15 }, { kind: "flip", prism: 0 }, { kind: "corner", corner: 2, to: [22, 21] }], tags: [] });
  assert.equal(run.failure, null, run.failure?.message);
  assert.equal(run.steps, 13);
});

test("hand-worked: a tiny face far from its sketch's origin keeps its area and middle", () => {
  // The triangle (200, 200), (200.006, 200), (200, 200.006): area ½ · 0.006² = 1.8e-5 and middle a third of the way
  // along each leg, (200.002, 200.002). Measured about the origin, the cross products (8e4) cancel to 3.6e-5 and the
  // middle came out ~1e-7 off; measured about the first corner it is exact to rounding.
  const t: [number, number][] = [
    [200, 200],
    [200.006, 200],
    [200, 200.006],
  ];
  assert.ok(Math.abs(twiceArea(t) / 2 - 1.8e-5) < 1e-17, `${twiceArea(t) / 2}`);
  const c = polygonCentroid(t);
  assert.ok(Math.abs(c[0] - 200.002) < 1e-12 && Math.abs(c[1] - 200.002) < 1e-12, `${c}`);
});

test("the checks' tolerances: 0.9× passes, 1.1× fails (volume and area 1e-9 relative, lengths 1e-9 × the chain's size)", async () => {
  // One block, 30 × 20 × 10 on XY: volume 6000, its corner (30, 20, 10) at the top.
  let doc = readDesignDocument({ version: 3, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } });
  const s = addSketch(doc);
  doc = s.doc;
  const c = square(0, 0, 30, 20);
  const lines: string[] = [];
  const points: string[] = [];
  for (let k = 0; k < 4; k++) {
    const l = drawLine(doc, s.id, points[k] ?? c[k], k === 3 ? points[0] : c[k + 1]);
    doc = l.doc;
    const curve = doc.sketches[0].curves.find((x) => x.id === l.id) as { start: string; end: string };
    lines.push(l.id);
    points[k] = curve.start;
    if (k < 3) points[k + 1] = curve.end;
  }
  const ex = extrudeSketch(doc, s.id, 10);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(ex.doc, cache, kernel);
  const bodies = await shownBodies(ex.doc, build, cache);
  const model = buildStack([{ on: null, shape: { kind: "polygon", corners: c }, distance: 10, flip: false }]);
  const drawn = [{ sketch: s.id, extrude: ex.id, lines, points }];
  const check = (view: object) => {
    try {
      checkStack("a test", model, drawn, build, [{ ...bodies[0], view: { ...bodies[0].view, ...view } }]);
      return "passes";
    } catch (e) {
      return e instanceof StackFailure ? e.check : `threw ${e}`;
    }
  };
  const v = bodies[0].view;
  assert.equal(check({}), "passes");
  // Volume 6000 off by 0.9 and 1.1 of 1e-9 × 6000 (the area moved along with it so only volume differs).
  assert.equal(check({ volume: 6000 * (1 + 0.9e-9) }), "passes");
  assert.equal(check({ volume: 6000 * (1 + 1.1e-9) }), "volume");
  // Surface 2·600 + 100·10 = 2200; the faces' areas must add up to it too (checked after, so the area check names it first).
  assert.equal(check({ area: 2200 * (1 + 1.1e-9) }), "area");
  // The chain's size here is 30 (its largest coordinate), so a corner may be 0.9 × 3e-8 off but not 1.1 ×.
  const corner = v.vertex_points.findIndex((p) => p[0] === 30 && p[1] === 20 && p[2] === 10);
  const moved = (by: number) => v.vertex_points.map((p, k) => (k === corner ? ([p[0] + by, p[1], p[2]] as [number, number, number]) : p));
  assert.equal(check({ vertex_points: moved(0.9 * 30e-9) }), "passes");
  assert.equal(check({ vertex_points: moved(1.1 * 30e-9) }), "corners");
  // A validation error, a grown tolerance, a face's normal turned or its middle moved, an open edge: each named.
  assert.equal(check({ errors: ["a planted error"] }), "valid");
  assert.equal(check({ tolerance: 2e-5 }), "valid");
  assert.equal(check({ face_normals: v.face_normals.map((n, k) => (k === 0 && n ? ([n[0] + 2e-9, n[1], n[2]] as [number, number, number]) : n)) }), "face");
  assert.equal(check({ face_centroids: v.face_centroids.map((p, k) => (k === 1 ? ([p[0] + 1.1 * 30e-9, p[1], p[2]] as [number, number, number]) : p)) }), "face");
  assert.equal(check({ edge_faces: v.edge_faces.map((e, k) => (k === 0 ? null : e)) }), "closed");
  await cache.clear();
});

const tagsSeen = new Map<string, number>();

/** Saves a shrunk failing chain so it replays forever (not while planted/run.ts plants a bug on purpose). */
function saveRegression(chain: StackChain, failure: StackFailure, shrunk: { length: number; edits: number }) {
  if (process.env.FISSION_PLANTED) return null;
  const dir = process.env.FISSION_STACK_OUT ? new URL(`file://${process.env.FISSION_STACK_OUT.replace(/\/?$/, "/")}`) : REGRESSIONS;
  mkdirSync(dir, { recursive: true });
  const file = new URL(`seed-${chain.seed}.json`, dir);
  const prisms = chain.prisms.slice(0, shrunk.length);
  writeFileSync(file, `${JSON.stringify({ seed: String(chain.seed), check: failure.check, failure: failure.message.slice(0, 500), prisms, edits: chain.edits.slice(0, shrunk.edits) }, null, 1)}\n`);
  return file.pathname;
}

test(`seeded chains (${SEEDS} from seed ${FIRST}): every step the model's, saved, reopened, undone and redone`, async () => {
  const failures: string[] = [];
  let skipped = 0;
  let steps = 0;
  for (let s = FIRST; s < FIRST + BigInt(SEEDS); s++) {
    const chain = chainOf(s);
    for (const t of chain.tags.flat()) tagsSeen.set(t, (tagsSeen.get(t) ?? 0) + 1);
    const run = await runStack(kernel, chain);
    skipped += run.skipped;
    steps += run.steps;
    if (run.failure) {
      // Shrunk only when it will be saved (a bug planted on purpose is not).
      const shrunk = process.env.FISSION_PLANTED ? { length: chain.prisms.length, edits: chain.edits.length } : await shrinkStack(kernel, chain, run.failure.check);
      const saved = saveRegression(chain, run.failure, shrunk);
      failures.push(`seed ${s} (${shrunk.length} prisms, ${shrunk.edits} edits${saved ? `, saved as ${saved}` : ""}): ${run.failure.message.slice(0, 400)}`);
      if (failures.length >= 3 || process.env.FISSION_PLANTED) break;
    }
  }
  console.log(`# ${SEEDS} chains, ${steps} steps checked, ${skipped} corner moves skipped (they would spoil the first outline); reached: ${[...tagsSeen].map(([t, n]) => `${t} ${n}`).join(", ")}`);
  if (failures.length > 0) assert.fail(failures.join("\n"));
  // Every kind of step the generator makes is reached (40 seeds reach the rarest, a face under 0.01 mm², about once in 3 chains).
  if (SEEDS >= 40) for (const t of ["xy", "on-side", "on-start", "on-end", "on-disc", "slanted", "side-back", "flipped", "tiny-face", "on-older", "deep", "copy", "triangle", "regular", "circle"]) assert.ok(tagsSeen.has(t), `no chain reached ${t}`);
});

test("saved regressions replay on Design", { skip: !existsSync(REGRESSIONS) && "none saved yet" }, async () => {
  for (const f of readdirSync(REGRESSIONS).filter((x) => x.endsWith(".json"))) {
    const saved = JSON.parse(readFileSync(new URL(f, REGRESSIONS), "utf8"));
    const run = await runStack(kernel, { seed: BigInt(saved.seed), prisms: saved.prisms, edits: saved.edits, tags: [] });
    assert.equal(run.failure, null, `${f}: ${run.failure?.message}`);
  }
});

/** The check each harness-side plant must fail, and the seed range it is looked for in. */
const CAUGHT: Record<StackFault, string> = {
  "save-drops-flip": "save and open",
  "undo-skips": "undo and redo",
  "model-long": "volume",
  "model-wrong-cap": "placement",
};

test("bugs planted in the harness are each caught by their check", async () => {
  for (const fault of STACK_FAULTS) {
    let got: string | null = null;
    for (let s = 1; s <= 20 && got === null; s++) got = (await runStack(kernel, chainOf(BigInt(s)), { faults: [fault] })).failure?.check ?? null;
    assert.equal(got, CAUGHT[fault], `${fault}: ${got ?? "not caught in 20 seeds"}`);
  }
});
