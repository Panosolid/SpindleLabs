// Mutants of the naming model (src/boolean-naming-model.ts) that its other
// tests let live (step 34a5b, Stryker target `naming`), each killed here by
// a hand-worked case: every expected id, volume and name is worked out from
// the blocks' corners in the comment beside it, never from the model. The
// mutants no caller can tell apart are explained in stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nameEdges,
  rebuildBooleans,
  resolveEdge,
  resolveFace,
  TIE,
  type BlockFeature,
  type BooleanRebuild,
  type CombineFeature,
  type DescribedFace,
  type Rect,
} from "../src/boolean-naming-model.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });
const combine = (id: string, target: string, tools: string[], operation: CombineFeature["operation"], keepTools = false): CombineFeature => ({ kind: "combine", id, target, tools, operation, keepTools });
/** Each body as "id volume low", as the hand-worked answers are written. */
const bodies = (r: BooleanRebuild) => r.bodies.map((b) => `${b.id} ${b.volume} ${b.low.join(",")}`);
const faceOn = (r: BooleanRebuild, body: string, facing: string, at: number) => {
  const found = r.bodies.find((b) => b.id === body)!.faces.filter((f) => f.facing === facing && f.at === at);
  assert.equal(found.length, 1, `one ${facing} face at ${at} on ${body}`);
  return found[0];
};
const BAR = block("feature-1", [0, 0, 100, 20], [0, 10]);
const NOT_VALID = "the rectangle or the heights are not valid";

test("a block with no width, depth or height, upside down, unbounded or with a line id twice fails, bodies kept", () => {
  const bad: [string, Partial<BlockFeature>][] = [
    ["infinite", { rect: [0, 0, Infinity, 10] }],
    ["no width", { rect: [5, 0, 5, 10] }],
    ["no depth", { rect: [0, 5, 10, 5] }],
    ["y backwards", { rect: [0, 10, 10, 0] }],
    ["no height", { z: [3, 3] }],
    ["z backwards", { z: [10, 0] }],
    ["line twice", { lines: ["a", "a", "b", "c"] }],
  ];
  for (const [what, change] of bad) {
    const r = rebuildBooleans([BAR, { ...block("feature-2", [0, 0, 10, 10], [0, 10]), ...change }]);
    // Only the bar is left, 100 × 20 × 10 = 20000; the bad block failed with words.
    assert.deepEqual(bodies(r), ["body:feature-1 20000 0,0,0"], what);
    assert.equal(r.failed.get("feature-2"), NOT_VALID, what);
  }
});

test("an id or a line id that cannot be written into a name fails as not valid text", () => {
  // "\ud800" is a lone surrogate: encodeURIComponent refuses it.
  for (const f of [block("feature-\ud800", [0, 0, 10, 10], [0, 10]), { ...block("feature-2", [0, 0, 10, 10], [0, 10]), lines: ["line-1", "line-\ud800", "line-3", "line-4"] as const }]) {
    const r = rebuildBooleans([BAR, f]);
    assert.deepEqual(bodies(r), ["body:feature-1 20000 0,0,0"]);
    assert.equal(r.failed.get(f.id), "an id is not valid text");
  }
});

test("an Extrude join listing no bodies makes a body of its own", () => {
  const r = rebuildBooleans([BAR, { kind: "block", id: "feature-2", rect: [0, 0, 10, 10], z: [20, 30], operation: "join" }]);
  // Nothing to join: the block alone, 10 × 10 × 10 = 1000 at (0, 0, 20), is body:feature-2.
  assert.deepEqual(bodies(r), ["body:feature-1 20000 0,0,0", "body:feature-2 1000 0,0,20"]);
  assert.equal(r.failed.size, 0);
});

test("a Combine picking one tool twice fails with words", () => {
  const r = rebuildBooleans([BAR, block("feature-2", [0, 0, 10, 10], [10, 20]), combine("feature-3", "body:feature-1", ["body:feature-2", "body:feature-2"], "join")]);
  assert.equal(r.failed.get("feature-3"), "a tool is picked twice");
  assert.deepEqual(bodies(r), ["body:feature-1 20000 0,0,0", "body:feature-2 1000 0,0,10"]);
});

test("decision 2: an Extrude join that puts an edge touch inside one body fails, though it is far from the touch", () => {
  // A x 0–10, y 0–10 and B x 10–20, y 10–20 (both z 0–10) touch only along
  // the upright x = 10, y = 10. B gets an arm x 20–30, y −30–20. The join's
  // block x 0–20, y −30–0 meets A's front (y = 0) and the arm's x = 20 side,
  // so A and B become one body with the upright inside it: refused, though
  // the block is nowhere near the upright (it stops at y = 0).
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [10, 10, 20, 20], [0, 10]),
    block("feature-3", [20, -30, 30, 20], [0, 10], "join", ["body:feature-2"]),
    block("feature-4", [0, -30, 20, 0], [0, 10], "join", ["body:feature-1", "body:feature-2"]),
  ]);
  assert.equal(r.failed.get("feature-4"), "the result would touch itself only along an edge or at a corner");
  // A 1000; B 1000 + its arm 10 × 50 × 10 = 5000: 6000, lowest corner
  // (smallest x, then y, then z) B's own (10, 10, 0).
  assert.deepEqual(bodies(r), ["body:feature-1 1000 0,0,0", "body:feature-2 6000 10,10,0"]);
});

test("decision 2: two cuts whose hollows touch only at a corner fail (the empty side pinches)", () => {
  // A cube 0–10; a cut takes the corner x −1–5, y −1–5, z 5–11, then a cut
  // the corner x 5–11, y 5–11, z −1–5. Round the point (5, 5, 5) the eight
  // cells are full but for the two opposite ones the cuts took: the solid's
  // six are joined through faces, the two empty ones are not, so the second
  // cut's result touches itself at that point and is refused.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [-1, -1, 5, 5], [5, 11], "cut", ["body:feature-1"]),
    block("feature-3", [5, 5, 11, 11], [-1, 5], "cut", ["body:feature-1"]),
  ]);
  assert.equal(r.failed.get("feature-3"), "the result would touch itself only along an edge or at a corner");
  // 1000 − 5 × 5 × 5 = 875, the first cut kept.
  assert.deepEqual(bodies(r), ["body:feature-1 875 0,0,0"]);
});

test("rule 1: pieces are numbered by the first face reaching them, then their share of it, before volume", () => {
  // Ben's bar 100 × 20 × 10 less three Combine tools: slots x 20–30 and x
  // 70–80 through it, and a layer x 30–70 at z 2–3. Four pieces: A x 0–20
  // (4000), Mb x 30–70 z 0–2 (40 × 20 × 2 = 1600), Mt x 30–70 z 3–10 (40 ×
  // 20 × 7 = 5600) and R x 80–100 (4000). Walk the bar's faces: the start
  // cap (z = 0) reaches A, Mb and R; the end cap A, Mt and R; line 1's side
  // all four; line 2's (x = 100) only R, which keeps body:feature-1. A and
  // Mb are first reached by the start cap, Mb with 40 × 20 = 800 of it, A
  // with 20 × 20 = 400: Mb is piece 1, A piece 2 (by volume it would be
  // last), and Mt, first reached by the end cap, piece 3 (by volume first).
  const r = rebuildBooleans([
    BAR,
    block("feature-2", [20, -5, 30, 25], [-5, 15]),
    block("feature-3", [70, -5, 80, 25], [-5, 15]),
    block("feature-4", [30, -5, 70, 25], [2, 3]),
    combine("feature-5", "body:feature-1", ["body:feature-2", "body:feature-3", "body:feature-4"], "cut"),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 4000 80,0,0", "body:feature-5/piece:1 1600 30,0,0", "body:feature-5/piece:2 4000 0,0,0", "body:feature-5/piece:3 5600 30,0,3"]);
});

test("rule 1: a face's surviving part is what counts, not the part the cut took", () => {
  // The F1 bar with the slot x 30–40, and a notch x 90–100, y −1–5, z −1–2
  // taking a bit of its far end. Line 2's side (x = 100) loses its corner
  // y 0–5, z 0–2 but what is left of it lies wholly in the far piece, which
  // keeps the id: 60 × 20 × 10 − 10 × 5 × 2 = 11900, from (40, 0, 0). The
  // near piece x 0–30, 6000.
  const r = rebuildBooleans([
    BAR,
    block("feature-2", [30, -5, 40, 25], [-5, 15]),
    block("feature-3", [90, -1, 101, 5], [-1, 2]),
    combine("feature-4", "body:feature-1", ["body:feature-2", "body:feature-3"], "cut"),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 11900 40,0,0", "body:feature-4/piece:1 6000 0,0,0"]);
});

test("rule 1: piece numbers past 9 still sort as numbers", () => {
  // A bar x 0–110 cut by ten slots x 9–10, 19–20, … 99–100: eleven pieces.
  // Line 2's side (x = 110) is wholly in the last, x 100–110, which keeps
  // the id (10 × 10 × 10 = 1000). The other ten, 9 × 10 × 10 = 900 each,
  // tie on every rank but their lowest corner: numbered from x = 0.
  const slots = [...Array(10).keys()].map((k) => block(`slot-${k}`, [10 * k + 9, -1, 10 * k + 10, 11], [-1, 11]));
  const r = rebuildBooleans([block("bar", [0, 0, 110, 10], [0, 10]), ...slots, combine("cut", "body:bar", slots.map((s) => `body:${s.id}`), "cut")]);
  assert.deepEqual(bodies(r), ["body:bar 1000 100,0,0", ...[...Array(10).keys()].map((k) => `body:cut/piece:${k + 1} 900 ${10 * k},0,0`)]);
});

test("rule 1: with an id used twice, the whole body still comes before its pieces", () => {
  // A bar "a" x 0–30, cut by a second feature also called "a" (x 10–20): the
  // far piece (x = 30's side wholly in it) keeps body:a, the near one is
  // body:a/piece:1. A join touching both lists the piece first; the earliest
  // made is body:a (body:F before body:F/piece:1), so the one body is body:a:
  // 1000 + 1000 + the block 20 × 5 × 10 = 1000, lowest corner (smallest x
  // first) the bar's (0, 0, 0).
  const r = rebuildBooleans([
    block("a", [0, 0, 30, 10], [0, 10]),
    block("a", [10, -1, 20, 11], [-1, 11], "cut", ["body:a"]),
    block("j", [5, -5, 25, 0], [0, 10], "join", ["body:a/piece:1", "body:a"]),
  ]);
  assert.deepEqual(bodies(r), ["body:a 3000 0,0,0"]);
});

test("rule 4: a merged face shows the target's name, then the tools' in the order picked, not made", () => {
  // Three 10 × 10 × 10 blocks in a row: T x 0–10, A x 10–20 (made second),
  // B x 20–30 (made third). Combine T with tools picked B then A: the tops
  // (z = 10) make one face, T's name first, then B's (picked first), then A's.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10]),
    block("feature-2", [10, 0, 20, 10], [0, 10]),
    block("feature-3", [20, 0, 30, 10], [0, 10]),
    combine("feature-4", "body:feature-1", ["body:feature-3", "body:feature-2"], "join"),
  ]);
  assert.deepEqual(faceOn(r, "body:feature-1", "+z", 10).names, ["face:feature-1/end", "face:feature-3/end", "face:feature-2/end"]);
});

test("rule 4: a name on the target and on a tool ranks as the target's", () => {
  // The F1 bar cut by the slot x 30–40: the far piece keeps body:feature-1,
  // the near one is body:feature-2/piece:1; both tops are still the bar's
  // end cap. A block made in the slot fills it; Combine the bar with tools
  // the filler, then the near piece. The one top answers to the bar's end
  // cap (the target's) first, then the filler's.
  const r = rebuildBooleans([
    BAR,
    block("feature-2", [30, -5, 40, 25], [-5, 15], "cut", ["body:feature-1"]),
    block("feature-3", [30, 0, 40, 20], [0, 10]),
    combine("feature-4", "body:feature-1", ["body:feature-3", "body:feature-2/piece:1"], "join"),
  ]);
  assert.deepEqual(bodies(r), ["body:feature-1 20000 0,0,0"]);
  assert.deepEqual(faceOn(r, "body:feature-1", "+z", 10).names, ["face:feature-1/end", "face:feature-3/end"]);
});

test("rule 4: a name on the target and on a tool takes its earliest place among the face's lists", () => {
  // N x 10–20 (made first) inside M x 10–30 (made second), all y 0–10, z
  // 0–10. Combine M with N, Keep tools: M's top lists M's end cap, then N's
  // (the target's first) where N's top lies in it. N then grows by a join
  // x 0–10 (P): N's top lists N's end cap, then P's. Combine M with N again:
  // one top x 0–30. M's names (from the target) rank first, P's after; of
  // M's two, N's end cap stands first in the lists over x 0–10 (N's own)
  // while M's never does better than first: tied on place, made order puts
  // N's (made first) before M's. Rule 4 does not yet say how a name both
  // inputs carry ranks (left for 35f, with Keep tools); this is what the
  // model and the unit-cell count both do.
  const r = rebuildBooleans([
    block("feature-1", [10, 0, 20, 10], [0, 10]),
    block("feature-2", [10, 0, 30, 10], [0, 10]),
    combine("feature-3", "body:feature-2", ["body:feature-1"], "join", true),
    block("feature-4", [0, 0, 10, 10], [0, 10], "join", ["body:feature-1"]),
    combine("feature-5", "body:feature-2", ["body:feature-1"], "join"),
  ]);
  // 30 × 10 × 10 = 3000.
  assert.deepEqual(bodies(r), ["body:feature-2 3000 0,0,0"]);
  assert.deepEqual(faceOn(r, "body:feature-2", "+z", 10).names, ["face:feature-1/end", "face:feature-2/end", "face:feature-4/end"]);
});

test("rule 5: one line of edges changes faces part way along it: two edges", () => {
  // A base x 0–20, y 0–10, z 0–10 and a wall joined to its front at x
  // 10–20, y −5–0, z 0–20. Along y = 0, z = 10 the base's top meets its
  // front (line 1's side, y = 0, left bare for x 0–10) and then, for x
  // 10–20, the wall's back (its line 3 side, y = 0, bare above z = 10):
  // two edges, 10 long each.
  const r = rebuildBooleans([block("feature-1", [0, 0, 20, 10], [0, 10]), block("feature-2", [10, -5, 20, 0], [0, 20], "join", ["body:feature-1"])]);
  const front = resolveEdge(r, "edge:face:feature-1/end+face:feature-1/side:line-1");
  const wall = resolveEdge(r, "edge:face:feature-1/end+face:feature-2/side:line-3");
  assert.ok("found" in front && front.found.length === 10);
  assert.ok("found" in wall && wall.found.length === 10);
});

test("a face's pieces of surface are listed in grid order: by z, then y, then x", () => {
  // A block x 0–20, y 0–20 whose top is cut into four by the lines x = 10
  // and y = 10 of another block far above. The top's rects, lowest corner
  // first by z, then y, then x: (0, 0), (10, 0), (0, 10), (10, 10), 10 × 10.
  const r = rebuildBooleans([block("feature-1", [0, 0, 20, 20], [0, 10]), block("feature-2", [10, 10, 30, 30], [50, 60])]);
  const sq = (x: number, y: number) => [[x, y, 10], [x + 10, y + 10, 10]];
  assert.deepEqual(faceOn(r, "body:feature-1", "+z", 10).rects, [sq(0, 0), sq(10, 0), sq(0, 10), sq(10, 10)]);
});

/** A rebuild of one body with the given faces and edges, for the reference rules alone. */
const made = (faces: Partial<DescribedFace>[], edges: { faces: [string, string]; ends: string[] }[] = []): BooleanRebuild => {
  const names = nameEdges(edges);
  const full = (f: Partial<DescribedFace>): DescribedFace => ({ names: [], facing: "+z", at: 0, area: 1, low: [0, 0, 0], full: f.names![0], tag: null, rects: [], ...f });
  return {
    bodies: [{ id: "body:b", volume: 1, low: [0, 0, 0], faces: faces.map(full), edges: edges.map((e, i) => ({ ...e, name: names[i], length: 1 })) }],
    tagFor: () => [],
    failed: new Map(),
  };
};

test("rule 3: two pieces exactly a billionth apart in area are tied: ambiguous", () => {
  // Areas 1e9 and 1e9 − 1 differ by 1, and a billionth of the larger is
  // 1e-9 × 1e9 = 1 (exact in doubles): a tie (≤), so neither is guessed. A
  // billionth of the smaller, 0.999999999, would not tie them.
  assert.equal(TIE * 1e9, 1);
  const r = made([
    { names: ["face:f/end"], area: 1e9 },
    { names: ["face:f/end"], area: 1e9 - 1 },
  ]);
  assert.deepEqual(resolveFace(r, { name: "face:f/end" }), { ambiguous: 2 });
});

test("references that find nothing say lost, and only lost", () => {
  const r = made([{ names: ["face:f/end"] }, { names: ["face:f/end"] }], [{ faces: ["a", "b"], ends: ["c"] }]);
  // No face carries the name.
  assert.deepEqual(resolveFace(r, { name: "face:g/end" }), { lost: true });
  // Two pieces, neither with the tag asked for (tagFor gives both []).
  assert.deepEqual(resolveFace(r, { name: "face:f/end", tag: ["face:x"] }), { lost: true });
  // No edge between a and d.
  assert.deepEqual(resolveEdge(r, "edge:a+d"), { lost: true });
});

test("rule 5: an edge name with ends fits every edge between its faces whose ends match it", () => {
  // Two edges between a and b with the same ends c, d are both shared
  // (null); a reference holding a + b with those ends fits both: ambiguous.
  const tied = made([], [
    { faces: ["a", "b"], ends: ["c", "d"] },
    { faces: ["a", "b"], ends: ["c", "d"] },
  ]);
  assert.deepEqual(resolveEdge(tied, "edge:a+b;ends:c,d"), { ambiguous: 2 });
  // One edge between a and b, named by its pair alone: a reference with
  // ends fits it once, which is not two: the name is not on any edge, lost
  // ("found when exactly one edge has it").
  const once = made([], [{ faces: ["a", "b"], ends: ["c", "d"] }]);
  assert.deepEqual(resolveEdge(once, "edge:a+b;ends:c,d"), { lost: true });
});
