// Split faces, edges and references in the model of names through booleans
// (src/boolean-naming-model.ts, step 34a3; rules 3 and 5 of
// docs/document-model.md, section 8), checked by hand: every tag, edge
// name and pick is worked out from the blocks' corners in the comment
// beside it. Each planted fault must make one of these fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOLEAN_FAULTS,
  nameEdges,
  rebuildBooleans,
  resolveEdge,
  resolveFace,
  type BlockFeature,
  type BooleanFault,
  type BooleanFeature,
  type BooleanRebuild,
  type CombineFeature,
  type FaceReference,
  type Rect,
} from "../src/boolean-naming-model.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });
const combine = (id: string, target: string, tools: string[], operation: CombineFeature["operation"]): CombineFeature => ({ kind: "combine", id, target, tools, operation });
const top = (r: BooleanRebuild, body: string) => r.bodies.find((b) => b.id === body)!.faces.find((f) => f.facing === "+z")!;
/** What a resolve found, as "body area" or "lost" or "ambiguous n", and its warning. */
const pick = (r: BooleanRebuild, ref: FaceReference, faults: BooleanFault[] = []) => {
  const got = resolveFace(r, ref, faults);
  return "found" in got ? `${got.body} ${got.found.area}${got.warning ? ` ${got.warning}` : ""}` : "lost" in got ? "lost" : `ambiguous ${got.ambiguous}`;
};

// Ben's bar (F1) and its slot at x 30–40, as in test/boolean-naming-model.test.ts.
const BAR = block("feature-1", [0, 0, 100, 20], [0, 10]);
const SLOT = block("feature-2", [30, -5, 40, 25], [-5, 15], "cut", ["body:feature-1"]);
const TOP = "face:feature-1/end";

test("rule 3: the bar's split top pieces are tagged with the faces only they border", () => {
  const r = rebuildBooleans([BAR, SLOT]);
  // The far top (x 40–100) borders the bar's line 1 and line 3 sides (y = 0,
  // y = 20), its line 2 side (x = 100) and the slot's line 2 wall (x = 40).
  // The near top (x 0–30) borders line 1, line 3, line 4 (x = 0) and the
  // slot's line 4 wall (x = 30). Lines 1 and 3 border both pieces, so the
  // tags are what is left, sorted.
  assert.equal(top(r, "body:feature-1").full, `${TOP}#face:feature-1/side:line-2,face:feature-2/side:line-2`);
  assert.equal(top(r, "body:feature-2/piece:1").full, `${TOP}#face:feature-1/side:line-4,face:feature-2/side:line-4`);
  // The bar's far end, x = 100, is whole: no other face carries its name, no tag.
  const end = r.bodies[0].faces.find((f) => f.facing === "+x")!;
  assert.equal(end.full, "face:feature-1/side:line-2");
  assert.equal(end.tag, null);
});

test("rule 3: a reference made on the whole top goes to the piece holding its origin, warned", () => {
  const r = rebuildBooleans([BAR, SLOT]);
  // Far top 60 × 20 = 1200, near 30 × 20 = 600.
  assert.equal(pick(r, { name: TOP, origin: [80, 10, 10] }), "body:feature-1 1200 split");
  assert.equal(pick(r, { name: TOP, origin: [10, 10, 10] }), "body:feature-2/piece:1 600 split");
  // An origin in the slot (x 35) is on neither piece: the largest, the far one, still warned.
  assert.equal(pick(r, { name: TOP, origin: [35, 10, 10] }), "body:feature-1 1200 split");
  // On the edge between piece and slot (x = 30): the near piece holds it (its edge is its own).
  assert.equal(pick(r, { name: TOP, origin: [30, 10, 10] }), "body:feature-2/piece:1 600 split");
  // Before the cut the top is whole: found, no warning (100 × 20 = 2000).
  assert.equal(pick(rebuildBooleans([BAR]), { name: TOP, origin: [80, 10, 10] }), "body:feature-1 2000");
});

test("rule 3: a tagged reference finds its piece, and the whole face once the cut is gone", () => {
  const near = ["face:feature-1/side:line-4", "face:feature-2/side:line-4"];
  assert.equal(pick(rebuildBooleans([BAR, SLOT]), { name: TOP, tag: near }), "body:feature-2/piece:1 600");
  // The slot deleted: one face carries the name again, so it is found whole (2000), no warning.
  assert.equal(pick(rebuildBooleans([BAR]), { name: TOP, tag: near }), "body:feature-1 2000");
  // The slot moved to x 70–80: the near piece's tag is now line 4 and the
  // slot's line 4 still (x 0–70, 70 × 20 = 1400).
  const moved = block("feature-2", [70, -5, 80, 25], [-5, 15], "cut", ["body:feature-1"]);
  assert.equal(pick(rebuildBooleans([BAR, moved]), { name: TOP, tag: near }), "body:feature-2/piece:1 1400");
  // A tag no piece has: lost, never moved to another piece. A name nothing carries: lost.
  assert.equal(pick(rebuildBooleans([BAR, SLOT]), { name: TOP, tag: ["face:feature-9/start"] }), "lost");
  assert.equal(pick(rebuildBooleans([BAR, SLOT]), { name: "face:feature-9/start" }), "lost");
});

test("rule 3: pieces with the same tag are never guessed between (two crossing slots)", () => {
  // A 20 × 20 top cut in four 9 × 9 = 81 pieces by slots at x 9–11 and y 9–11.
  // The piece at (0, 0) borders line 1, line 4 and the walls x = 9, y = 9;
  // line 4 and the x = 9 wall border the (0, 11) piece too, line 1 and the
  // y = 9 wall the (11, 0) piece. So every neighbour is shared and all four
  // tags are empty: the same tag four times.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 20, 20], [0, 10]),
    block("feature-2", [9, -1, 11, 21], [-1, 11]),
    block("feature-3", [-1, 9, 21, 11], [-1, 11]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut"),
  ]);
  for (const b of r.bodies) assert.deepEqual(top(r, b.id).tag, []);
  assert.equal(pick(r, { name: TOP, tag: [] }), "ambiguous 4");
  // An untagged reference whose origin is in the slots' crossing: no piece
  // holds it and the four are equally large, so it is ambiguous too.
  assert.equal(pick(r, { name: TOP, origin: [10, 10, 10] }), "ambiguous 4");
  // Its origin on a piece: that piece.
  assert.equal(pick(r, { name: TOP, origin: [15, 5, 10] }), "body:feature-4/piece:2 81 split");
});

test("rule 5: edges are named by their two faces' full names, sorted", () => {
  const box = rebuildBooleans([block("feature-1", [0, 0, 10, 20], [0, 30])]);
  // A box: 12 edges, each between two of its six faces, every name once.
  assert.equal(box.bodies[0].edges.length, 12);
  // The edge along y = 0, z = 30: the end cap and line 1's side, "end" before "side" in text order, 10 long.
  const front = resolveEdge(box, "edge:face:feature-1/end+face:feature-1/side:line-1");
  assert.ok("found" in front && front.found.length === 10);
  // The upright at (10, 20): lines 2 and 3, 30 long.
  const upright = resolveEdge(box, "edge:face:feature-1/side:line-2+face:feature-1/side:line-3");
  assert.ok("found" in upright && upright.found.length === 30);
  // A pair that never meets (the two caps): no edge.
  assert.ok("lost" in resolveEdge(box, "edge:face:feature-1/end+face:feature-1/start"));
  // Ben's bar after the slot: the far top meets the slot's x = 40 wall along y 0–20.
  const r = rebuildBooleans([BAR, SLOT]);
  const wall = resolveEdge(r, `edge:${TOP}#face:feature-1/side:line-2,face:feature-2/side:line-2+face:feature-2/side:line-2`);
  assert.ok("found" in wall && wall.found.length === 20 && wall.body === "body:feature-1");
  // Each piece is a box again: 12 edges each.
  assert.deepEqual(r.bodies.map((b) => b.edges.length), [12, 12]);
});

test("rule 5: two faces meeting twice are told apart by the faces at the ends (an upside-down U on a block)", () => {
  // A block x 0–100, y 0–20, z 0–10; a U from a block x 20–70, y 5–15, z
  // 10–20, cut x 30–60 up to z 15, joined onto it. The U's front (its line
  // 1 side, y = 5) meets the block's top along x 20–30 and x 60–70: twice.
  // At the first foot's ends: the U's line 4 side (x = 20) and the cut's
  // line 4 wall (x = 30); at the second, the cut's line 2 wall (x = 60) and
  // the U's line 2 side (x = 70).
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 100, 20], [0, 10]),
    block("feature-2", [20, 5, 70, 15], [10, 20]),
    block("feature-3", [30, 4, 60, 16], [9, 15], "cut", ["body:feature-2"]),
    combine("feature-4", "body:feature-1", ["body:feature-2"], "join"),
  ]);
  // 20000 + 50 × 10 × 10 − 30 × 10 × 5 = 23500.
  assert.equal(r.bodies[0].volume, 23500);
  const pair = "edge:face:feature-1/end+face:feature-2/side:line-1";
  const first = resolveEdge(r, `${pair};ends:face:feature-2/side:line-4,face:feature-3/side:line-4`);
  const second = resolveEdge(r, `${pair};ends:face:feature-2/side:line-2,face:feature-3/side:line-2`);
  assert.ok("found" in first && first.found.length === 10);
  assert.ok("found" in second && second.found.length === 10);
  // The pair alone names neither: a reference made while they met once
  // (the U before its cut) fits both, so it is ambiguous, never guessed
  // (it said "lost" until the 34a5 review: the edge is not gone, it is two).
  assert.deepEqual(resolveEdge(r, pair), { ambiguous: 2 });
  // Edges, counted by hand: the block's 12; the U's top 4 and outer
  // uprights 4; each foot's 4 on the block's top (8); the cut's ceiling 4
  // and its walls' uprights 4: 36.
  assert.equal(r.bodies[0].edges.length, 36);
});

test("rule 5: an edge reference whose two faces come to meet twice is ambiguous, not lost", () => {
  // Regression (fresh-eyes review, 34a5): a bar x 0–10, y 0–2, z 0–2, and
  // an Extrude cut notch x 4–6, y −1–1, z 1–3 in its top front edge. The
  // top (z = 2, the end cap) and the front (y = 0, line 1's side) both stay
  // one face each (the notch bites a corner out of each), and now meet
  // along x 0–4 and x 6–10: two edges, 4 long each. A reference made on
  // the bar, by the pair alone, fits both.
  const r = rebuildBooleans([block("feature-1", [0, 0, 10, 2], [0, 2]), block("feature-2", [4, -1, 6, 1], [1, 3], "cut", ["body:feature-1"])]);
  const pair = "edge:face:feature-1/end+face:feature-1/side:line-1";
  assert.equal(r.bodies.length, 1);
  assert.deepEqual(r.bodies[0].edges.filter((e) => e.name?.startsWith(`${pair};`)).map((e) => e.length), [4, 4]);
  assert.deepEqual(resolveEdge(r, pair), { ambiguous: 2 });
});

test("rule 5: a pair whose end faces tie too is shared, never guessed", () => {
  // Two edges between faces a and b ending on the same faces: both null.
  // A third edge between a and c is named by its pair alone.
  const names = nameEdges([
    { faces: ["a", "b"], ends: ["c", "d"] },
    { faces: ["a", "b"], ends: ["c", "d"] },
    { faces: ["a", "c"], ends: ["b", "d"] },
    { faces: ["a", "b"], ends: ["e"] },
  ]);
  assert.deepEqual(names, [null, null, "edge:a+c", "edge:a+b;ends:e"]);
});

// The planted faults of rules 3 and 5: each must break one of the hand-worked cases.
const CASES: { name: string; features: BooleanFeature[]; refs: FaceReference[]; edges: string[] }[] = [
  {
    name: "bar",
    features: [BAR, SLOT],
    refs: [{ name: TOP, origin: [10, 10, 10] }, { name: TOP, tag: ["face:feature-1/side:line-4", "face:feature-2/side:line-4"] }],
    edges: [],
  },
  {
    name: "crossing",
    features: [block("feature-1", [0, 0, 20, 20], [0, 10]), block("feature-2", [9, -1, 11, 21], [-1, 11]), block("feature-3", [-1, 9, 21, 11], [-1, 11]), combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut")],
    refs: [{ name: TOP, tag: [] }, { name: TOP, origin: [10, 10, 10] }],
    edges: [],
  },
  {
    name: "U",
    features: [block("feature-1", [0, 0, 100, 20], [0, 10]), block("feature-2", [20, 5, 70, 15], [10, 20]), block("feature-3", [30, 4, 60, 16], [9, 15], "cut", ["body:feature-2"]), combine("feature-4", "body:feature-1", ["body:feature-2"], "join")],
    refs: [],
    edges: ["edge:face:feature-1/end+face:feature-2/side:line-1;ends:face:feature-2/side:line-4,face:feature-3/side:line-4"],
  },
];

const seen = (c: (typeof CASES)[number], faults: BooleanFault[]) => {
  const r = rebuildBooleans(c.features, faults);
  return JSON.stringify({
    full: r.bodies.map((b) => b.faces.map((f) => f.full)),
    refs: c.refs.map((ref) => pick(r, ref, faults)),
    edges: c.edges.map((e) => "found" in resolveEdge(r, e)),
  });
};

test("every planted fault of rules 3 and 5 changes a hand-worked case's answer", () => {
  // The tag listing shared neighbours changes the bar's full names; a
  // silent split drops the bar's warning; largest-first sends the bar's
  // origin (10, 10) to the far piece; guessing picks one of the crossing's
  // four; edges without their ends lose the U's first foot.
  const expect: Partial<Record<BooleanFault, string>> = {
    "tag-all-neighbours": "bar",
    "split-silent": "bar",
    "largest-first": "bar",
    "guess-shared": "crossing",
    "edge-no-ends": "U",
  };
  const mine = BOOLEAN_FAULTS.slice(BOOLEAN_FAULTS.indexOf("pinch-allowed") + 1);
  assert.deepEqual(mine, Object.keys(expect));
  for (const fault of mine) {
    const caught = CASES.filter((c) => seen(c, [fault]) !== seen(c, [])).map((c) => c.name);
    assert.ok(caught.includes(expect[fault]!), `${fault} is caught by ${expect[fault]} (caught by: ${caught.join(", ") || "nothing"})`);
  }
});
