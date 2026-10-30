// The model of names through joins, cuts and Combine
// (src/boolean-naming-model.ts, step 34a2) checked by hand: every expected
// id, volume and name is worked out from the blocks' corners in the comment
// beside it, never from the model. Each planted fault (one per rule) must
// make one of these fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOLEAN_FAULTS,
  rebuildBooleans,
  type BlockFeature,
  type BooleanFault,
  type BooleanFeature,
  type BooleanRebuild,
  type CombineFeature,
  type Rect,
} from "../src/boolean-naming-model.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });
const combine = (id: string, target: string, tools: string[], operation: CombineFeature["operation"], keepTools = false): CombineFeature => ({ kind: "combine", id, target, tools, operation, keepTools });
/** Each body as "id volume low": what the hand-worked answers are written as. */
const bodies = (r: BooleanRebuild) => r.bodies.map((b) => `${b.id} ${b.volume} ${b.low.join(",")}`);
const face = (r: BooleanRebuild, body: string, facing: string, at: number) => {
  const found = r.bodies.find((b) => b.id === body)!.faces.filter((f) => f.facing === facing && f.at === at);
  assert.equal(found.length, 1, `one ${facing} face at ${at} on ${body}`);
  return found[0];
};

// Ben's bar (Fusion check F1): 100 × 20 × 10, cut through by a slot at x 30–40.
const BAR = block("feature-1", [0, 0, 100, 20], [0, 10]);
const slot = (x0: number, x1: number) => block("feature-2", [x0, -5, x1, 25], [-5, 15], "cut", ["body:feature-1"]);

test("F1: the piece with the bar's far end keeps the bar's id", () => {
  const r = rebuildBooleans([BAR, slot(30, 40)]);
  // Walk the bar's faces in made order: the start cap (z = 0), the end cap
  // (z = 10) and line 1's side (y = 0) all run from x = 0 to 100, so the
  // slot splits them; line 2's side is x = 100, wholly in the far piece,
  // x 40–100: that piece keeps body:feature-1. Far 60 × 20 × 10 = 12000,
  // lowest corner (40, 0, 0); near 30 × 20 × 10 = 6000, the only other piece,
  // piece 1, lowest corner (0, 0, 0).
  assert.deepEqual(bodies(r), ["body:feature-1 12000 40,0,0", "body:feature-2/piece:1 6000 0,0,0"]);
  assert.equal(r.failed.size, 0);
});

test("F1: the far piece keeps the id even when it is the smaller one", () => {
  const r = rebuildBooleans([BAR, slot(70, 80)]);
  // The same walk: x = 100 is still the first face wholly in one piece, now
  // the far piece x 80–100, 20 × 20 × 10 = 4000, against the near 70 × 20 ×
  // 10 = 14000. Ben's check: it stays Body1 when made the smaller one.
  assert.deepEqual(bodies(r), ["body:feature-1 4000 80,0,0", "body:feature-2/piece:1 14000 0,0,0"]);
});

test("rule 2: a cut's walls are named after the tool's sides", () => {
  const r = rebuildBooleans([BAR, slot(30, 40)]);
  // The slot's rectangle (30, -5)–(40, 25): line 2 runs along x = 40 and
  // line 4 along x = 30. The far piece's wall at x = 40 faces −x and lies
  // on the slot's line-2 side; the near piece's at x = 30 faces +x on its
  // line-4 side. Each is 20 (y) × 10 (z) = 200.
  const far = face(r, "body:feature-1", "-x", 40);
  assert.deepEqual(far.names, ["face:feature-2/side:line-2"]);
  assert.equal(far.area, 200);
  const near = face(r, "body:feature-2/piece:1", "+x", 30);
  assert.deepEqual(near.names, ["face:feature-2/side:line-4"]);
  // The bar's own faces keep their names: the far piece's end is line 2's side, 20 × 10.
  assert.deepEqual(face(r, "body:feature-1", "+x", 100).names, ["face:feature-1/side:line-2"]);
});

test("rule 2: a hole's walls are the tool's sides, and the cap round it stays one face", () => {
  const r = rebuildBooleans([block("feature-1", [0, 0, 30, 30], [0, 10]), block("feature-2", [10, 10, 20, 20], [-1, 11], "cut", ["body:feature-1"])]);
  // 30 × 30 × 10 = 9000 less the 10 × 10 × 10 hole = 8000, still one piece.
  assert.deepEqual(bodies(r), ["body:feature-1 8000 0,0,0"]);
  // The wall at x = 10 has material on its −x side, so it faces +x; it is
  // the tool's line-4 side (x = x0 = 10), 10 × 10 = 100.
  assert.deepEqual(face(r, "body:feature-1", "+x", 10).names, ["face:feature-2/side:line-4"]);
  assert.equal(face(r, "body:feature-1", "+x", 10).area, 100);
  // The top is a ring, one face: 900 − 100 = 800.
  assert.equal(face(r, "body:feature-1", "+z", 10).area, 800);
});

test("rule 1: pieces after the keeper are ranked by the first face reaching them, not by size", () => {
  // A 10 × 10 × 30 post cut by two slabs, z 5–7 and z 25–27, into a bottom
  // (z 0–5, 500), a middle (z 7–25, 1800) and a top (z 27–30, 300).
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 30]),
    block("feature-2", [-1, -1, 11, 11], [5, 7]),
    block("feature-3", [-1, -1, 11, 11], [25, 27]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut"),
  ]);
  // Walk: the start cap (z = 0) is wholly in the bottom, which keeps the
  // id. The end cap (z = 30), next, reaches the top first: piece 1. The
  // middle is reached only by the sides, later: piece 2, though it is the
  // largest. The tools are used up (keep tools off).
  assert.deepEqual(bodies(r), ["body:feature-1 500 0,0,0", "body:feature-4/piece:1 300 0,0,27", "body:feature-4/piece:2 1800 0,0,7"]);
});

test("rule 1: with no face wholly in one piece, the first by rank keeps the id (two crossing slots)", () => {
  // A 20 × 20 × 10 block cut by a slot along y at x 9–11 and one along x at
  // y 9–11: four 9 × 9 × 10 = 810 pieces. Every face is split (the caps in
  // four, each side in two), so no face decides. Rank: the start cap
  // reaches all four first, with equal shares (81) and volumes, so the
  // lowest corners decide: (0, 0, 0) keeps the id, then (0, 11, 0), (11, 0,
  // 0), (11, 11, 0), smaller x first, then y.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 20, 20], [0, 10]),
    block("feature-2", [9, -1, 11, 21], [-1, 11]),
    block("feature-3", [-1, 9, 21, 11], [-1, 11]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut"),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 810 0,0,0", "body:feature-4/piece:1 810 0,11,0", "body:feature-4/piece:2 810 11,0,0", "body:feature-4/piece:3 810 11,11,0"]);
});

test("rule 1: an Extrude cut through two bodies numbers its pieces on across them", () => {
  // Two 30 × 10 × 10 bars, y 0–10 and y 20–30, cut by one slot at x 10–20
  // listing both. Each keeps its x 20–30 piece (line 2's side, x = 30, is
  // the first face wholly in one piece): 10 × 10 × 10 = 1000 each. The x
  // 0–10 pieces are new: the first bar's piece 1, the second's piece 2.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 30, 10], [0, 10]),
    block("feature-2", [0, 20, 30, 30], [0, 10]),
    block("feature-3", [10, -1, 20, 31], [-1, 11], "cut", ["body:feature-1", "body:feature-2"]),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 1000 20,0,0", "body:feature-2 1000 20,20,0", "body:feature-3/piece:1 1000 0,0,0", "body:feature-3/piece:2 1000 0,20,0"]);
});

test("F2: a Combine join of two blocks apart keeps the target and makes the tool a new body", () => {
  // Two 10 × 10 × 10 blocks with a 10 mm gap: no error, two bodies. The
  // target's piece keeps body:feature-1; the tool's lump is a new body,
  // piece 1 of the Combine (Fusion's Body3), and the tool's own id is gone.
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [20, 0, 30, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.deepEqual(bodies(r), ["body:feature-1 1000 0,0,0", "body:feature-3/piece:1 1000 20,0,0"]);
  assert.equal(r.failed.size, 0);
});

test("F2: a Combine join keeps the target's id on the piece holding the target, even when a tool swallows it and a bigger tool lies apart", () => {
  // Regression (found by the 34a5 sessions' unit-cell count, then built by
  // hand): target a 1 mm cube at (1, 1, 1)–(2, 2, 2), inside tool 1, the
  // 3 × 3 × 3 cube (0, 0, 0)–(3, 3, 3) = 27, with tool 2 apart, the
  // 4 × 4 × 4 cube at x 10–14 = 64. Every face of the target ends inside
  // tool 1, so none survives to point at a piece; section 8 still says the
  // piece holding the target keeps its id: the 27 piece at (0, 0, 0). The
  // 64 apart is the Combine's piece 1. The model gave the target's id to
  // the bigger piece, ranked first by volume when no face reached either.
  const r = rebuildBooleans([
    block("feature-1", [1, 1, 2, 2], [1, 2]),
    block("feature-2", [0, 0, 3, 3], [0, 3]),
    block("feature-3", [10, 0, 14, 4], [0, 4]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "join"),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 27 0,0,0", "body:feature-4/piece:1 64 10,0,0"]);
});

test("F6's rule: an Extrude join bridging two bodies keeps the earliest-made id, and its top answers to all three names", () => {
  // Blocks x 0–10 and x 20–30 (10 × 10 × 10 each), then a join x 5–25
  // listing the later body first. The union is x 0–30: 30 × 10 × 10 = 3000,
  // one body, body:feature-1 (made before feature-2).
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [20, 0, 30, 10], [0, 10]),
    block("feature-3", [5, 0, 25, 10], [0, 10], "join", ["body:feature-2", "body:feature-1"]),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 3000 0,0,0"]);
  // The three tops lie in z = 10 and touch: one 30 × 10 = 300 face. Rule 4:
  // the earliest participant's name first, then the other's, then the
  // extrude's own.
  const top = face(r, "body:feature-1", "+z", 10);
  assert.deepEqual(top.names, ["face:feature-1/end", "face:feature-2/end", "face:feature-3/end"]);
  assert.equal(top.area, 300);
  // A box has six faces once the inner walls are gone.
  assert.equal(r.bodies[0].faces.length, 6);
});

test("rule 4: a Combine join shows the target's names first, even when the target was made later", () => {
  // Blocks x 0–10 and x 10–20, touching at x = 10; the later one is the
  // target. One 20 × 10 × 10 = 2000 body keeping the target's id; its top
  // shows the target's name first.
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 0, 20, 10], [0, 10]), combine("feature-3", "body:feature-2", ["body:feature-1"], "join")]);
  assert.deepEqual(bodies(r), ["body:feature-2 2000 0,0,0"]);
  assert.deepEqual(face(r, "body:feature-2", "+z", 10).names, ["face:feature-2/end", "face:feature-1/end"]);
  // The front (y = 0) likewise: each block's line 1 side.
  assert.deepEqual(face(r, "body:feature-2", "-y", 0).names, ["face:feature-2/side:line-1", "face:feature-1/side:line-1"]);
  // A later cut leaves the order shown: a notch in the far corner doesn't
  // turn the top round to made order.
  const later = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [10, 0, 20, 10], [0, 10]),
    combine("feature-3", "body:feature-2", ["body:feature-1"], "join"),
    block("feature-4", [15, 5, 25, 15], [5, 15], "cut", ["body:feature-2"]),
  ]);
  assert.deepEqual(face(later, "body:feature-2", "+z", 10).names, ["face:feature-2/end", "face:feature-1/end"]);
});

test("Keep tools leaves the tool as it was", () => {
  const r = rebuildBooleans([block("feature-1", [0, 0, 20, 10], [0, 10]), block("feature-2", [10, -1, 30, 11], [-1, 11]), combine("feature-3", "body:feature-1", ["body:feature-2"], "cut", true)]);
  // 20 × 10 × 10 less x 10–20: 1000 left; the tool, 20 × 12 × 12 = 2880, kept.
  assert.deepEqual(bodies(r), ["body:feature-1 1000 0,0,0", "body:feature-2 2880 10,-1,-1"]);
});

test("F3: a cut that would leave nothing fails with words and keeps both bodies", () => {
  // A 40 × 40 tool swallowing a 20 × 20 target.
  const target = block("feature-1", [0, 0, 20, 20], [0, 10]);
  const tool = block("feature-2", [-10, -10, 30, 30], [-1, 11]);
  const r = rebuildBooleans([target, tool, combine("feature-3", "body:feature-1", ["body:feature-2"], "cut")]);
  assert.equal(r.failed.get("feature-3"), "it would leave nothing of body:feature-1");
  // 20 × 20 × 10 = 4000 and 40 × 40 × 12 = 19200, both as they were.
  assert.deepEqual(bodies(r), ["body:feature-1 4000 0,0,0", "body:feature-2 19200 -10,-10,-1"]);
  // An Extrude cut swallowing a body: the same.
  const e = rebuildBooleans([target, block("feature-2", [-10, -10, 30, 30], [-1, 11], "cut", ["body:feature-1"])]);
  assert.equal(e.failed.get("feature-2"), "it would leave nothing of body:feature-1");
  assert.deepEqual(bodies(e), ["body:feature-1 4000 0,0,0"]);
  // Intersect of blocks that only touch (x = 10): nothing shared, fails.
  const i = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 0, 20, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "intersect")]);
  assert.equal(i.failed.get("feature-3"), "it would leave nothing of body:feature-1");
  assert.equal(i.bodies.length, 2);
});

test("intersect keeps what both share, its faces named after whichever input they lie on", () => {
  // x 0–20 and x 10–30 (y 0–10, z 0–10) share x 10–20: 1000. Its x = 10 face
  // lies on the tool's line 4 side, its x = 20 on the target's line 2 side;
  // the top lies on both tops, the target's first.
  const r = rebuildBooleans([block("feature-1", [0, 0, 20, 10], [0, 10]), block("feature-2", [10, 0, 30, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "intersect")]);
  assert.deepEqual(bodies(r), ["body:feature-1 1000 10,0,0"]);
  assert.deepEqual(face(r, "body:feature-1", "-x", 10).names, ["face:feature-2/side:line-4"]);
  assert.deepEqual(face(r, "body:feature-1", "+x", 20).names, ["face:feature-1/side:line-2"]);
  assert.deepEqual(face(r, "body:feature-1", "+z", 10).names, ["face:feature-1/end", "face:feature-2/end"]);
});

test("decision 2: bodies joined along only an edge or at only a corner are refused", () => {
  // Two 10 mm cubes meeting along the upright edge x = 10, y = 10.
  const edge = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 10, 20, 20], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.equal(edge.failed.get("feature-3"), "the result would touch itself only along an edge or at a corner");
  assert.equal(edge.bodies.length, 2);
  // Meeting only at the corner (10, 10, 10).
  const corner = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 10, 20, 20], [10, 20]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.equal(corner.failed.get("feature-3"), "the result would touch itself only along an edge or at a corner");
  // A cut leaving two pieces joined along an edge: a 20 × 20 block less the
  // squares x 0–10, y 0–10 and x 10–20, y 10–20 (one tool each, combined).
  const cut = rebuildBooleans([
    block("feature-1", [0, 0, 20, 20], [0, 10]),
    block("feature-2", [-1, -1, 10, 10], [-1, 11]),
    block("feature-3", [10, 10, 21, 21], [-1, 11]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut"),
  ]);
  assert.equal(cut.failed.get("feature-4"), "the result would touch itself only along an edge or at a corner");
  // Faces meeting flush are not a pinch: the touching join above is fine.
  const flush = rebuildBooleans([block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 0, 20, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")]);
  assert.equal(flush.failed.size, 0);
});

test("refusals: a target that is also a tool, a missing body, a broken block", () => {
  const a = block("feature-1", [0, 0, 10, 10], [0, 10]);
  assert.equal(rebuildBooleans([a, combine("feature-2", "body:feature-1", ["body:feature-1"], "join")]).failed.get("feature-2"), "the target is also a tool");
  assert.equal(rebuildBooleans([a, combine("feature-2", "body:feature-1", ["body:feature-9"], "cut")]).failed.get("feature-2"), "no body body:feature-9");
  assert.equal(rebuildBooleans([a, combine("feature-2", "body:feature-1", [], "cut")]).failed.get("feature-2"), "no tool bodies");
  assert.equal(rebuildBooleans([block("feature-1", [10, 0, 0, 10], [0, 10])]).failed.get("feature-1"), "the rectangle or the heights are not valid");
  // A failed feature leaves what came before for what comes after.
  const r = rebuildBooleans([a, combine("feature-2", "body:feature-1", ["body:feature-1"], "join"), block("feature-3", [5, -1, 15, 11], [-1, 11], "cut", ["body:feature-1"])]);
  assert.deepEqual(bodies(r), ["body:feature-1 500 0,0,0"]);
});

// The planted faults: each must break at least one hand-worked case above.
const CASES: { name: string; features: BooleanFeature[] }[] = [
  { name: "F1", features: [BAR, slot(30, 40)] },
  { name: "F1 smaller", features: [BAR, slot(70, 80)] },
  { name: "slabs", features: [block("feature-1", [0, 0, 10, 10], [0, 30]), block("feature-2", [-1, -1, 11, 11], [5, 7]), block("feature-3", [-1, -1, 11, 11], [25, 27]), combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut")] },
  { name: "two bars", features: [block("feature-1", [0, 0, 30, 10], [0, 10]), block("feature-2", [0, 20, 30, 30], [0, 10]), block("feature-3", [10, -1, 20, 31], [-1, 11], "cut", ["body:feature-1", "body:feature-2"])] },
  { name: "F2", features: [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [20, 0, 30, 10], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")] },
  { name: "F6", features: [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [20, 0, 30, 10], [0, 10]), block("feature-3", [5, 0, 25, 10], [0, 10], "join", ["body:feature-2", "body:feature-1"])] },
  { name: "hole", features: [block("feature-1", [0, 0, 30, 30], [0, 10]), block("feature-2", [10, 10, 20, 20], [-1, 11], "cut", ["body:feature-1"])] },
  { name: "swallowed", features: [block("feature-1", [0, 0, 20, 20], [0, 10]), block("feature-2", [-10, -10, 30, 30], [-1, 11]), combine("feature-3", "body:feature-1", ["body:feature-2"], "cut")] },
  { name: "edge touch", features: [block("feature-1", [0, 0, 10, 10], [0, 10]), block("feature-2", [10, 10, 20, 20], [0, 10]), combine("feature-3", "body:feature-1", ["body:feature-2"], "join")] },
];

/** The faults of rules 1, 2 and 4 and the refusals; rules 3 and 5's are test/boolean-naming-split.test.ts's. */
const RULE_1_2_4_FAULTS = BOOLEAN_FAULTS.slice(0, BOOLEAN_FAULTS.indexOf("pinch-allowed") + 1);

/** Everything the hand-worked cases look at, as text, so a fault shows as a difference. */
const seen = (r: BooleanRebuild) =>
  JSON.stringify({ bodies: r.bodies.map((b) => ({ ...b, faces: b.faces.map((f) => [f.names, f.facing, f.at, f.area]) })), failed: [...r.failed] });

test("every planted fault changes a hand-worked case's answer", () => {
  const caught = new Map<BooleanFault, string[]>();
  for (const fault of RULE_1_2_4_FAULTS)
    caught.set(
      fault,
      CASES.filter((c) => seen(rebuildBooleans(c.features, [fault])) !== seen(rebuildBooleans(c.features))).map((c) => c.name),
    );
  // Which case catches which fault, worked out from each rule: the first
  // face (not the largest piece, not the first face reaching any piece)
  // decides F1 smaller; the slabs' top is numbered before the larger middle;
  // the two bars' pieces never both piece 1; F6 keeps feature-1 and its top
  // lists feature-1 first; F2's lump is a new id; the hole's wall is the
  // tool's; the swallowed target fails; the edge touch is refused.
  const expect: Partial<Record<BooleanFault, string>> = {
    "keep-largest": "F1 smaller",
    "keep-first-reached": "F1",
    "number-by-volume": "slabs",
    "number-per-body": "two bars",
    "join-latest": "F6",
    "tool-keeps-id": "F2",
    "wall-target-name": "hole",
    "merge-tool-first": "F6",
    "merge-one-name": "F6",
    "empty-allowed": "swallowed",
    "pinch-allowed": "edge touch",
  };
  for (const fault of RULE_1_2_4_FAULTS) assert.ok(caught.get(fault)!.includes(expect[fault]), `${fault} is caught by ${expect[fault]} (caught by: ${caught.get(fault)!.join(", ") || "nothing"})`);
});
