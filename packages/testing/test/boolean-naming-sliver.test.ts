// The naming model's sizes (step 35ed1), checked by hand: coordinates within
// LINEAR (10 nm) are one plane, and a result with a wall, gap or step
// thinner than MIN_FEATURE (1 µm) fails its feature in the kernel's words,
// judged on the result only. Every expected answer is worked out from the
// blocks' corners in the comment beside it, never from the model. Each
// planted fault in SIZE_FAULTS must make one of these fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINEAR,
  MIN_FEATURE,
  rebuildBooleans,
  SIZE_FAULTS,
  SLIVER,
  type BlockFeature,
  type BooleanFault,
  type BooleanFeature,
  type BooleanRebuild,
  type CombineFeature,
  type Rect,
} from "../src/boolean-naming-model.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });
const combine = (id: string, target: string, tools: string[], operation: CombineFeature["operation"], keepTools = false): CombineFeature => ({ kind: "combine", id, target, tools, operation, keepTools });
const ids = (r: BooleanRebuild) => r.bodies.map((b) => b.id);
const volume = (r: BooleanRebuild, id: string) => r.bodies.find((b) => b.id === id)!.volume;
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);

// A 10 × 10 × 10 cube on the origin; volume 1000.
const CUBE = block("feature-1", [0, 0, 10, 10], [0, 10]);
/** A cut through the whole plan from below up to `top`: it leaves z top–10. */
const cutUpTo = (top: number) => block("feature-2", [-1, -1, 11, 11], [-1, top], "cut", ["body:feature-1"]);
/** A cut through the whole plan from `bottom` up past the top: it leaves the floor z 0–bottom. */
const cutDownTo = (bottom: number) => block("feature-2", [-1, -1, 11, 11], [bottom, 11], "cut", ["body:feature-1"]);
/** A block over x 5–15 on the cube's footprint in y, from 0 to `top`, joined to the cube. */
const joinTo = (top: number) => block("feature-2", [5, 0, 15, 10], [0, top], "join", ["body:feature-1"]);

test("a cut leaving a floor 0.5 µm thick is refused in the kernel's words, the cube kept", () => {
  // The cut takes z 0.0005–11 over the whole plan: what is left is the slab
  // z 0–0.0005, 0.5 µm < 1 µm thick, so the feature fails and the cube stays
  // 10 × 10 × 10 = 1000.
  const r = rebuildBooleans([CUBE, cutDownTo(0.0005)]);
  assert.equal(r.failed.get("feature-2"), SLIVER);
  assert.equal(SLIVER, "it would leave a gap or sliver thinner than 1 µm");
  assert.deepEqual(ids(r), ["body:feature-1"]);
  near(volume(r, "body:feature-1"), 1000, "the cube");
});

test("a floor at 0.9× MIN_FEATURE is refused, at 1.1× it is kept", () => {
  // 0.9 µm < 1 µm: refused. 1.1 µm: a floor 10 × 10 × 0.0011 = 0.11.
  const thin = rebuildBooleans([CUBE, cutDownTo(0.9 * MIN_FEATURE)]);
  assert.equal(thin.failed.get("feature-2"), SLIVER);
  const ok = rebuildBooleans([CUBE, cutDownTo(1.1 * MIN_FEATURE)]);
  assert.equal(ok.failed.size, 0);
  near(volume(ok, "body:feature-1"), 0.11, "the 1.1 µm floor");
});

test("a typed 1 µm far from the origin is 1 µm: its rounding is allowed for", () => {
  // A floor from z = 1000 to 1000.001: in doubles 1000.001 − 1000 is
  // 9.99999999976e-4, under 1e-3 by 2.4e-14, but a difference of two typed
  // values may miss by 4 ulps of the larger (4 × 2.2e-16 × 1000 = 8.9e-13),
  // so it is 1 µm, not less. Kept: 10 × 10 × 0.001 = 0.1 (to rounding).
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [1000, 1010]), block("feature-2", [-1, -1, 11, 11], [1000.001, 1011], "cut", ["body:feature-1"])]);
  assert.equal(r.failed.size, 0);
  assert.ok(Math.abs(volume(r, "body:feature-1") - 0.1) < 1e-9);
});

test("a cut whose far wall ends 0.5 µm outside the part is fine: only the result is judged", () => {
  // The cut runs from 0.5 µm below the cube's bottom (z −0.0005) up to 5,
  // so it takes z 0–5 and leaves z 5–10 = 500. The plane z = −0.0005 is
  // 0.5 µm from the cube's bottom, but nothing of the result lies on it.
  const r = rebuildBooleans([CUBE, block("feature-2", [-1, -1, 11, 11], [-0.0005, 5], "cut", ["body:feature-1"])]);
  assert.equal(r.failed.size, 0);
  near(volume(r, "body:feature-1"), 500, "the top half");
  // The same from the side: a slot x −0.0005–5 through the whole height leaves x 5–10, 500.
  const side = rebuildBooleans([CUBE, block("feature-2", [-0.0005, -1, 5, 11], [-1, 11], "cut", ["body:feature-1"])]);
  assert.equal(side.failed.size, 0);
  near(volume(side, "body:feature-1"), 500, "the far half");
  // And a cut leaving z 0.0005–10 (removing the 0.5 µm floor itself) is fine too: 10 × 10 × 9.9995 = 999.95.
  const shaved = rebuildBooleans([CUBE, cutUpTo(0.0005)]);
  assert.equal(shaved.failed.size, 0);
  near(volume(shaved, "body:feature-1"), 999.95, "the shaved cube");
});

test("a join whose top stands 0.5 µm above the part's is a step that short: refused", () => {
  // The block x 5–15 reaches z 10.0005; over x 5–10 it lies inside the cube
  // below z 10. The result's top is z = 10 over x 0–5 and z = 10.0005 over
  // x 5–15: the edge between them, along x = 5, is 0.5 µm tall. Refused.
  const r = rebuildBooleans([CUBE, joinTo(10.0005)]);
  assert.equal(r.failed.get("feature-2"), SLIVER);
  assert.deepEqual(ids(r), ["body:feature-1"]);
  near(volume(r, "body:feature-1"), 1000, "the cube");
  // A Combine join of the same blocks: the same step, the same words.
  const c = rebuildBooleans([CUBE, block("feature-2", [5, 0, 15, 10], [0, 10.0005]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.equal(c.failed.get("feature-3"), SLIVER);
  assert.deepEqual(ids(c), ["body:feature-1", "body:feature-2"]);
});

test("a step at 0.9× MIN_FEATURE is refused, at 1.1× it is kept", () => {
  // 10.0009: a 0.9 µm step, refused. 10.0011: 1.1 µm, kept; volume
  // 5 × 10 × 10 (x 0–5) + 10 × 10 × 10.0011 (x 5–15) = 500 + 1000.11 = 1500.11.
  assert.equal(rebuildBooleans([CUBE, joinTo(10 + 0.9 * MIN_FEATURE)]).failed.get("feature-2"), SLIVER);
  const ok = rebuildBooleans([CUBE, joinTo(10 + 1.1 * MIN_FEATURE)]);
  assert.equal(ok.failed.size, 0);
  near(volume(ok, "body:feature-1"), 1500.11, "the joined part");
});

test("0.3 and 0.1 + 0.2 are one plane: the join's top is one face with both names", () => {
  // 0.1 + 0.2 is 0.30000000000000004 in doubles, 5.55e-17 above 0.3: far
  // within LINEAR, so one plane at 0.3. A plate x 0–10 up to 0.1 + 0.2 and
  // a join x 5–15 up to 0.3 make one top over x 0–15 (decision 6), 15 × 10
  // = 150, answering to the plate's end first (the target's, rule 4), then
  // the join's; volume 15 × 10 × 0.3 = 45.
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 0.1 + 0.2]), block("feature-2", [5, 0, 15, 10], [0, 0.3], "join", ["body:feature-1"])]);
  assert.equal(r.failed.size, 0);
  const body = r.bodies[0];
  near(body.volume, 45, "the plate");
  const tops = body.faces.filter((f) => f.facing === "+z");
  assert.equal(tops.length, 1);
  assert.equal(tops[0].at, 0.3);
  near(tops[0].area, 150, "the top");
  assert.deepEqual(tops[0].names, ["face:feature-1/end", "face:feature-2/end"]);
});

test("planes 0.9× LINEAR apart are one, 1.1× LINEAR apart are two (and then a step under 1 µm)", () => {
  // 0.9 × 10 nm = 9 nm: one plane at z = 10, the top one face of 150 as above
  // (volume 15 × 10 × 10 = 1500). 11 nm: two planes, a step 11 nm tall,
  // under 1 µm: refused (the kernel refuses this band at its input, in other words).
  const one = rebuildBooleans([CUBE, joinTo(10 + 0.9 * LINEAR)]);
  assert.equal(one.failed.size, 0);
  const tops = one.bodies[0].faces.filter((f) => f.facing === "+z");
  assert.deepEqual(
    tops.map((f) => [f.at, f.area]),
    [[10, 150]],
  );
  near(one.bodies[0].volume, 1500, "one plane");
  assert.equal(rebuildBooleans([CUBE, joinTo(10 + 1.1 * LINEAR)]).failed.get("feature-2"), SLIVER);
});

test("a typed 10 nm 100 m out is 10 nm: its rounding is allowed for, so the planes are one", () => {
  // A plate 100 m tall (z 0–100000) and a join up to 100000.00001: in
  // doubles 100000.00001 − 100000 is 1.0000003e-5, over LINEAR by 3.4e-12,
  // within the 4 ulps a difference of typed values may miss by (4 × 2.2e-16
  // × 1e5 = 8.9e-11). One plane: one top face, 15 × 10 = 150, kept.
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 100000]), block("feature-2", [5, 0, 15, 10], [0, 100000.00001], "join", ["body:feature-1"])]);
  assert.equal(r.failed.size, 0);
  assert.deepEqual(
    r.bodies[0].faces.filter((f) => f.facing === "+z").map((f) => [f.at, f.area]),
    [[100000, 150]],
  );
});

test("an Extrude join standing 0.5 µm off the body it joins is a thin gap: refused", () => {
  // The cube x 0–10 and a block x 10.0005–20 listing it: a gap 0.5 µm wide
  // between x = 10 and x = 10.0005, made by this feature. Refused, the cube kept.
  const r = rebuildBooleans([CUBE, block("feature-2", [10.0005, 0, 20, 10], [0, 10], "join", ["body:feature-1"])]);
  assert.equal(r.failed.get("feature-2"), SLIVER);
  assert.deepEqual(ids(r), ["body:feature-1"]);
});

test("bodies 0.5 µm apart joined by Combine are a thin gap: refused; 1.1 µm apart they join as two pieces", () => {
  // A x 0–10, B x 10.0005–20: a gap 0.5 µm wide between A's x = 10 and B's
  // face. Refused. At 1.1 µm the join leaves two lumps: A keeps its id,
  // B's lump is the Combine's piece 1 (F2), each 1000.
  const at = (gap: number) => rebuildBooleans([CUBE, block("feature-2", [10 + gap, 0, 20, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.equal(at(0.0005).failed.get("feature-3"), SLIVER);
  const ok = at(1.1 * MIN_FEATURE);
  assert.equal(ok.failed.size, 0);
  assert.deepEqual(ids(ok), ["body:feature-1", "body:feature-3/piece:1"]);
});

test("an Extrude join leaves alone a thin gap between listed bodies it does not touch", () => {
  // Bodies a, x 0–10, and b, x 10.0005–20 (made apart, as two extrudes may
  // be). A join x 0–5, y −5–0 listing both touches only a: a grows by
  // 5 × 5 × 10 = 250 to 1250, b stays 9.9995 × 10 × 10 = 999.95; the gap was not made here (as
  // decision 2's edge touch, test/boolean-naming-model.test.ts).
  const r = rebuildBooleans([CUBE, block("feature-2", [10.0005, 0, 20, 10], [0, 10]), block("feature-3", [0, -5, 5, 0], [0, 10], "join", ["body:feature-1", "body:feature-2"])]);
  assert.equal(r.failed.size, 0);
  near(volume(r, "body:feature-1"), 1250, "a");
  near(volume(r, "body:feature-2"), 999.95, "b");
  // But a join x 5–10, y −5–0 is refused: its corner edge at x 10, y 0
  // comes within 0.5 µm of b's face x = 10.0005, a gap this feature makes.
  const bridge = rebuildBooleans([CUBE, block("feature-2", [10.0005, 0, 20, 10], [0, 10]), block("feature-3", [5, -5, 10, 0], [0, 10], "join", ["body:feature-1", "body:feature-2"])]);
  assert.equal(bridge.failed.get("feature-3"), SLIVER);
});

test("a new block thinner than 1 µm, or flat within LINEAR, is refused", () => {
  // 10 × 10 × 0.0005: a wall 0.5 µm thick. 10 × 10 × 5 nm: one plane, nothing.
  assert.equal(rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 0.0005])]).failed.get("feature-1"), SLIVER);
  assert.equal(rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 0.5 * LINEAR])]).failed.get("feature-1"), SLIVER);
  assert.equal(rebuildBooleans([block("feature-1", [0, 0, 0.0005, 10], [0, 10])]).failed.get("feature-1"), SLIVER);
  // 1.1 µm thick: kept, 10 × 10 × 0.0011 = 0.11.
  near(rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 1.1 * MIN_FEATURE])]).bodies[0].volume, 0.11, "the thin plate");
});

test("a thin wall left between a pocket and the side is refused; one in x as well as in z", () => {
  // A pocket x 0.0005–9, y 1–9, z 1–11 in the cube leaves the wall x 0–0.0005: 0.5 µm. Refused.
  const r = rebuildBooleans([CUBE, block("feature-2", [0.0005, 1, 9, 9], [1, 11], "cut", ["body:feature-1"])]);
  assert.equal(r.failed.get("feature-2"), SLIVER);
  // The pocket from x 0.0011 leaves 1.1 µm: kept, 1000 − 8.9989 × 8 × 9 = 1000 − 647.9208 = 352.0792.
  const ok = rebuildBooleans([CUBE, block("feature-2", [0.0011, 1, 9, 9], [1, 11], "cut", ["body:feature-1"])]);
  assert.equal(ok.failed.size, 0);
  near(volume(ok, "body:feature-1"), 352.0792, "the pocketed cube");
});

// The planted faults: each must break one hand-worked case above.
const CASES: { name: string; features: BooleanFeature[] }[] = [
  { name: "0.3 vs 0.1 + 0.2", features: [block("feature-1", [0, 0, 10, 10], [0, 0.1 + 0.2]), block("feature-2", [5, 0, 15, 10], [0, 0.3], "join", ["body:feature-1"])] },
  { name: "0.5 µm floor", features: [CUBE, cutDownTo(0.0005)] },
  { name: "0.5 µm step", features: [CUBE, joinTo(10.0005)] },
];
const seen = (r: BooleanRebuild) => JSON.stringify({ bodies: r.bodies.map((b) => [b.id, b.volume, b.faces.map((f) => [f.names, f.at])]), failed: [...r.failed] });

test("every size fault changes the hand-worked case it breaks", () => {
  // Two planes 5.55e-17 apart make a step that short (refused); a floor
  // never refused is a body; a step never refused is a body.
  const expect: Record<string, BooleanFault> = { "0.3 vs 0.1 + 0.2": "near-planes-apart", "0.5 µm floor": "thin-allowed", "0.5 µm step": "step-allowed" };
  assert.deepEqual(Object.values(expect).sort(), [...SIZE_FAULTS].sort());
  for (const c of CASES) {
    const fault = expect[c.name];
    assert.notEqual(seen(rebuildBooleans(c.features, [fault])), seen(rebuildBooleans(c.features)), `${fault} is caught by ${c.name}`);
  }
  // And each fault only where its check is the one deciding: the step's
  // fault leaves the floor refused, the thin fault leaves the step refused.
  assert.equal(rebuildBooleans(CASES[1].features, ["step-allowed"]).failed.get("feature-2"), SLIVER);
  assert.equal(rebuildBooleans(CASES[2].features, ["thin-allowed"]).failed.get("feature-2"), SLIVER);
});
