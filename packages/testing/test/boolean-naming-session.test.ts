// Step 34a5: the naming model of joins, cuts and Combine
// (src/boolean-naming-model.ts) held against a second, independent count
// on unit cells (src/boolean-naming-cells.ts) through seeded sessions
// (src/boolean-naming-session.ts), and against itself moved, scaled and
// renamed. The unit-cell count is checked by hand first, so the two are
// not only agreeing with each other; then every planted fault must make a
// session disagree, so the sessions are shown to be able to fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOLEAN_FAULTS, ORDER_FAULTS, type BlockFeature, type BooleanFault, type Rect } from "../src/boolean-naming-model.ts";
import { cellsCanCount, countOnCells, resolveOnCells } from "../src/boolean-naming-cells.ts";
import { firstDifference, invarianceDifference, moved, nameBack, randomBooleanSession, strangeIds } from "../src/boolean-naming-session.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });

/** How many sessions every pull request runs, and how long each is. */
const SESSIONS = Number(process.env.BOOLEAN_SESSIONS ?? 40);
const STEPS = 10;

test("the unit-cell count by hand: a small bar cut by a slot (F1)", () => {
  // A 10 × 2 × 1 bar, cut through by a slot at x 3–4. Walking the bar's
  // faces in made order: start (z = 0) and end (z = 1) and line 1's side
  // (y = 0) run x 0–10, so the slot splits them; line 2's side (x = 10) is
  // the first wholly in one piece, the far one, x 4–10: 6 × 2 × 1 = 12
  // cells, lowest corner (4, 0, 0), keeps body:feature-1. The near piece,
  // x 0–3, 3 × 2 × 1 = 6, is the slot's piece 1.
  const r = countOnCells([block("feature-1", [0, 0, 10, 2], [0, 1]), block("feature-2", [3, -1, 4, 3], [-1, 2], "cut", ["body:feature-1"])]);
  assert.deepEqual(
    r.bodies.map((b) => `${b.id} ${b.volume} ${b.low.join(",")}`),
    ["body:feature-1 12 4,0,0", "body:feature-2/piece:1 6 0,0,0"],
  );
  // The far piece's wall at x = 4 faces −x and lies on the slot's line-2
  // side (x = 4 is the slot's x1): 2 (y) × 1 (z) = 2 squares.
  const wall = r.bodies[0].faces.find((f) => f.facing === "-x")!;
  assert.deepEqual([wall.names, wall.at, wall.area], [["face:feature-2/side:line-2"], 4, 2]);
  // The bar's top is now two faces carrying face:feature-1/end, so each is
  // tagged with what borders it and not the other: the far top (x 4–10)
  // with the bar's x = 10 side (line 2) and the slot's x = 4 wall (line 2);
  // both border line 1's and line 3's sides, which the near top borders too.
  const top = r.bodies[0].faces.find((f) => f.facing === "+z")!;
  assert.equal(top.full, "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2");
  assert.equal(top.area, 12);
  assert.equal(r.failed.size, 0);
});

test("the unit-cell count by hand: a box's faces and edges", () => {
  // A 3 × 2 × 1 box: six faces (bottom and top 3 × 2 = 6, front and back
  // 3 × 1 = 3, left and right 2 × 1 = 2) and twelve edges: four of
  // length 3 (along x), four of 2 (along y), four of 1 (along z). Each edge
  // meets its two faces once, so no edge needs its ends and none is shared;
  // the edge along x at y = 0, z = 0 is between the start cap and line 1's
  // side, its ends lines 2's and 4's sides.
  const r = countOnCells([block("feature-1", [0, 0, 3, 2], [0, 1])]);
  const b = r.bodies[0];
  assert.deepEqual(b.faces.map((f) => `${f.facing} ${f.area}`), ["-z 6", "+z 6", "-y 3", "+x 2", "+y 3", "-x 2"]);
  assert.deepEqual(b.edges.map((e) => e.length).sort(), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.ok(b.edges.every((e) => e.name !== null && !e.name.includes(";ends:")));
  const e = b.edges.find((x) => x.name === "edge:face:feature-1/side:line-1+face:feature-1/start")!;
  assert.deepEqual([e.length, e.ends], [3, ["face:feature-1/side:line-2", "face:feature-1/side:line-4"]]);
});

test("the unit-cell count by hand: a reference to a split top goes to the piece holding its origin, warned", () => {
  // The bar and slot above: a sketch made on the whole top with its origin
  // at (8, 1, 1) is on the far piece (x 4–10); with its origin in the slot,
  // (3.5, 1, 1), no piece holds it, so the larger piece, the far one
  // (12 against 6), with a warning either way.
  const r = countOnCells([block("feature-1", [0, 0, 10, 2], [0, 1]), block("feature-2", [3, -1, 4, 3], [-1, 2], "cut", ["body:feature-1"])]);
  const far = { body: "body:feature-1", full: "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2" };
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", origin: [8, 1, 1] }), { found: far, warned: true });
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", origin: [3.5, 1, 1] }), { found: far, warned: true });
  // The near piece by its tag: the bar's x = 0 side (line 4) and the slot's x = 3 wall (line 4).
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", tag: ["face:feature-1/side:line-4", "face:feature-2/side:line-4"] }).found, {
    body: "body:feature-2/piece:1",
    full: "face:feature-1/end#face:feature-1/side:line-4,face:feature-2/side:line-4",
  });
});

test("the unit-cell count refuses parts it cannot count", () => {
  const half = [block("feature-1", [0, 0, 2.5, 2], [0, 1])];
  assert.equal(cellsCanCount(half), false);
  assert.throws(() => countOnCells(half), /whole-millimetre/);
  assert.equal(cellsCanCount(moved(half, 2, [0, 0, 0])), true);
});

test(`${SESSIONS} seeded sessions of ${STEPS} features: the model and the unit-cell count agree at every step, and moving, scaling and renaming change nothing`, () => {
  let features = 0;
  let references = 0;
  let pieces = 0;
  let failed = 0;
  for (let seed = 0; seed < SESSIONS; seed++) {
    const s = randomBooleanSession(BigInt(seed), STEPS);
    assert.equal(firstDifference(s), null);
    assert.equal(invarianceDifference(s), null);
    features += s.features.length;
    references += s.references.length;
    const r = countOnCells(s.features);
    pieces += r.bodies.filter((b) => b.id.includes("/piece:")).length;
    failed += r.failed.size;
  }
  // The sessions do what they are for: references made and pieces numbered, and features refused.
  assert.equal(features, SESSIONS * STEPS);
  assert.ok(references > SESSIONS, `${references} references`);
  assert.ok(pieces > SESSIONS / 4, `${pieces} pieces`);
  assert.ok(failed > SESSIONS / 4, `${failed} refused`);
});

test("the sessions are the same for the same seed", () => {
  assert.deepEqual(randomBooleanSession(7n, STEPS), randomBooleanSession(7n, STEPS));
  assert.notDeepEqual(randomBooleanSession(7n, STEPS).features, randomBooleanSession(8n, STEPS).features);
});

/** The first seed whose session each planted fault makes disagree (found by searching seeds 0–299 once, kept so it replays). */
const CAUGHT_AT: Record<BooleanFault, number> = {
  "keep-largest": 6,
  "keep-first-reached": 18,
  "number-by-volume": 10,
  "number-per-body": 34,
  "join-latest": 4,
  "tool-keeps-id": 6,
  "wall-target-name": 0,
  "merge-tool-first": 1,
  "merge-one-name": 1,
  "empty-allowed": 2,
  "pinch-allowed": 2,
  "tag-all-neighbours": 0,
  "split-silent": 10,
  "largest-first": 10,
  "guess-shared": 1,
  "edge-no-ends": 7,
  "made-by-id-text": 0,
  "grid-whole-mm": 0,
};

test("every planted fault in the model makes a seeded session disagree with the unit-cell count", () => {
  assert.deepEqual(Object.keys(CAUGHT_AT).sort(), [...BOOLEAN_FAULTS, ...ORDER_FAULTS].sort());
  for (const fault of BOOLEAN_FAULTS) {
    const s = randomBooleanSession(BigInt(CAUGHT_AT[fault]), STEPS);
    assert.equal(firstDifference(s), null, `seed ${CAUGHT_AT[fault]} agrees without ${fault}`);
    assert.notEqual(firstDifference(s, [fault]), null, `${fault} is caught by seed ${CAUGHT_AT[fault]}`);
  }
});

test("an order taken from ids' text is caught by renaming, and coordinates taken to whole millimetres by moving", () => {
  for (const fault of ORDER_FAULTS) {
    const s = randomBooleanSession(BigInt(CAUGHT_AT[fault]), STEPS);
    assert.equal(invarianceDifference(s), null);
    const d = invarianceDifference(s, [fault]);
    assert.match(d ?? "", fault === "made-by-id-text" ? /renamed/ : /moved/);
  }
});

test("names put back after renaming: ids renamed back and every list sorted by text sorted again", () => {
  // Worked by hand: ids "b" → "feature-1", "a" → "feature-2", so the tag
  // "face:a/x,face:b/y" becomes "face:feature-2/x,face:feature-1/y", sorted
  // again: feature-1's first. The edge's faces and ends are sorted the same way.
  const back = (id: string) => ({ a: "feature-2", b: "feature-1" })[id] ?? id;
  assert.equal(nameBack("face:b/end#face:a/x,face:b/y", back), "face:feature-1/end#face:feature-1/y,face:feature-2/x");
  assert.equal(nameBack("edge:face:a/end+face:b/start;ends:face:a/z,face:b/z", back), "edge:face:feature-1/start+face:feature-2/end;ends:face:feature-1/z,face:feature-2/z");
  assert.equal(nameBack("body:a/piece:2", back), "body:feature-2/piece:2");
  assert.equal(nameBack("face:b/side:a", back), "face:feature-1/side:feature-2");
  // The new ids run backwards in text order, and carry every separator a name uses.
  const ids = [...strangeIds([block("feature-1", [0, 0, 1, 1], [0, 1])]).values()];
  assert.deepEqual(ids.slice(0, 2), ["z0 /+#,;@:x", "y1 /+#,;@:x"]);
  assert.ok(ids.every((id, i) => i === 0 || id < ids[i - 1]));
});
