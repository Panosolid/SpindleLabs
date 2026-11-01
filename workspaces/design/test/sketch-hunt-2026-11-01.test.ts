// Regression tests for the 2026-11-01 drawing-tools hunt:
// 1. a 3-point arc drawn again over the same arc through another of its
//    points was drawn on top (its centre came out a rounding off the
//    first's, so it was not "the same three points");
// 2. an arc's worked-out centre a rounding off a point already there was
//    a second point on top of it, and clicking that point twice then drew
//    a line or circle 4e-16 mm long (the snap took the twin, since only
//    the tool's own click exactly was left out);
// 3. the line and circle tools drew sizes under the modeller's smallest
//    piece (0.001 mm), which the kernel then refused with the whole sketch.
// Each with its hand-worked case and the 0.9× / 1.1× boundary of the
// tolerance it compares against; the kernel itself is asked where the
// tool's rule must agree with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { addSketch, drawArc, drawCircle, drawLine, sketchCurves, sketchOutline } from "../src/sketch.ts";
import { clickAt, MIN_SIZE, NO_RADIUS, SHARED_CENTRE, SHORT_LINE, SMALL_CIRCLE, SMALL_RECTANGLE, startTool, type SketchTool } from "../src/sketch-tool.ts";
import { arcThere, SAME_ARC } from "../src/centre-arc.ts";
import { SAME_PLACE, SNAP_PIXELS, snapOnSketch, snapTargets } from "../src/snap.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";

const kernel = nodeKernel();
const fresh = () => addSketch(partDocument("box", 40, 30, 20));

/** Clicks as the workspace makes them: the pointer at `raw`, rounded to itself, snapped (pixel 0.001 mm), then the tool. */
function clicks<T extends SketchTool>(doc: DesignDocument, tool: T, at: SketchXY[], snap = false) {
  let drew = 0;
  let note: string | undefined;
  for (const raw of at) {
    const p = snap ? snapOnSketch(doc, tool, raw, raw, 0.001).at : raw;
    const r = clickAt(doc, tool, p);
    doc = r.doc;
    tool = r.tool as T;
    note = r.note;
    if (r.drew) drew++;
  }
  return { doc, tool, drew, note };
}

async function outlineWords(doc: DesignDocument, id: string): Promise<string> {
  try {
    await sketchOutline(kernel, doc, id);
    return "closed";
  } catch (e) {
    return String(e);
  }
}

// ---- 1. The same arc twice ----

test("hunt-1101-1: a 3-point arc drawn again through another point of the same arc draws nothing (SAME_ARC)", async () => {
  const s = fresh();
  // The circle round c = (12.5, −3.2) with r = 5 (0.1 mm decimals): A = c + (4, 3) = (16.5, −0.2), B = c + (5, 0) = (17.5, −3.2),
  // c + (−5, 0) = (7.5, −3.2) and c + (0, −5) = (12.5, −8.2), each √(4² + 3²) = 5 or 5 from c, so all four are on it,
  // and the last two both on the long way round from A to B: the same arc, through two of its points.
  const A: SketchXY = [16.5, -0.2];
  const B: SketchXY = [17.5, -3.2];
  const D = clicks(s.doc, startTool("line", s.id), [A, B]).doc; // the chord, so the arc closes a D
  const first = clicks(D, startTool("arc", s.id), [A, B, [7.5, -3.2]]);
  assert.equal(first.drew, 1);
  assert.equal(await outlineWords(first.doc, s.id), "closed");
  const again = clicks(first.doc, startTool("arc", s.id), [A, B, [12.5, -8.2]]);
  assert.equal(again.drew, 0, `drew a second arc: ${JSON.stringify(sketchCurves(again.doc.sketches[0]).arcs)}`);
  assert.equal(again.note, SAME_ARC);
  assert.equal(await outlineWords(again.doc, s.id), "closed");
});

test("hunt-1101-1 boundary: an arc's centre 0.9× SAME_PLACE from an arc with the same ends is on top of it, 1.1× is another arc", () => {
  const s = fresh();
  // Ends (±5, 0) round (0, 0): a half circle. The arcs with these two ends and a centre within SAME_PLACE (the kernel's one
  // place) of (0, 0) are one arc to it; δ along the y axis, so the new centre is (0, δ).
  const drawn = drawArc(s.doc, s.id, [5, 0], [-5, 0], [0, 0]).doc;
  const sk = drawn.sketches[0];
  const [a, b] = [sk.points[0].id, sk.points[1].id];
  assert.equal(arcThere(sk, a, b, [0, 0.9 * SAME_PLACE]), true);
  assert.equal(arcThere(sk, a, b, [0, 1.1 * SAME_PLACE]), false);
  // The other way round (the ends swapped) is the rest of the circle, never on top.
  assert.equal(arcThere(sk, b, a, [0, 0.9 * SAME_PLACE]), false);
});

// ---- 2. Twin points ----

/** A circle round C = (−2, −2), r = 0.5, then a 3-point arc through three points of it. */
function concentric() {
  const s = fresh();
  let doc = clicks(s.doc, startTool("circle", s.id), [[-2, -2], [-2, -1.5]]).doc;
  // C + (0.3, 0.4), C + (−0.3, 0.4), C + (−0.3, −0.4) as 0.1 mm decimals: each √(0.09 + 0.16) = 0.5 from C, so the arc's
  // centre is C. Worked out in doubles it comes out (−2, −2.0000000000000004), a rounding off C.
  doc = clicks(doc, startTool("arc", s.id), [[-1.7000000000000002, -1.6], [-2.3000000000000003, -1.6], [-2.3000000000000003, -2.4000000000000004]]).doc;
  return { doc, id: s.id };
}

test("hunt-1101-2: an arc's centre worked out a rounding off a point already there shares that point", () => {
  const { doc } = concentric();
  const sk = doc.sketches[0];
  const circle = sk.curves.find((c) => c.kind === "circle")!;
  const arc = sk.curves.find((c) => c.kind === "arc")!;
  // Hand-worked above: the arc's centre is C, the circle's centre point: 1 centre + 2 ends = 3 points, not 4.
  assert.equal(arc.kind === "arc" && circle.kind === "circle" && arc.centre === circle.centre, true, JSON.stringify(sk.points));
  assert.equal(sk.points.length, 3);
});

test("hunt-1101-2: clicking a circle's centre twice draws no line and no circle", () => {
  const { doc, id } = concentric();
  // The pointer exactly on C both times: the first click lands on C, the second on C again (a click on the chain's start, or
  // on the circle's centre), so nothing is drawn; before the fix the second landed on C's twin 4e-16 mm away.
  const line = clicks(doc, startTool("line", id), [[-2, -2], [-2, -2]], true);
  assert.equal(line.drew, 0, JSON.stringify(sketchCurves(line.doc.sketches[0]).lines));
  const circle = clicks(doc, startTool("circle", id), [[-2, -2], [-2, -2]], true);
  assert.equal(circle.drew, 0, JSON.stringify(sketchCurves(circle.doc.sketches[0]).circles));
  assert.equal(circle.note, NO_RADIUS);
});

test("hunt-1101-2 boundary: a point 0.9× SHARED_CENTRE from an arc's centre is shared, 1.1× is not", () => {
  // Ends (5, 0) and (−5, 0) through (0, 5): m = (0, 0), d = (−10, 0), so the centre m + d⊥·k has x = 0 − 0·k = 0, and
  // k = (|p − m|² − |d|²/4) / (2·cross) = (25 − 25) / … = 0: the centre is (0, 0) exactly.
  for (const [f, shared] of [[0.9, true], [1.1, false]] as const) {
    const s = fresh();
    const doc = drawCircle(s.doc, s.id, [f * SHARED_CENTRE, 0], 1).doc; // a point f·SHARED_CENTRE from (0, 0)
    const r = clicks(doc, startTool("arc", s.id), [[5, 0], [-5, 0], [0, 5]]);
    const sk = r.doc.sketches[0];
    const arc = sk.curves.find((c) => c.kind === "arc")!;
    assert.equal(arc.kind === "arc" && arc.centre === sk.points[0].id, shared, `${f}×: ${JSON.stringify(sk.points)}`);
  }
});

test("hunt-1101-2: a tangent arc's centre a rounding off a point already there shares it", () => {
  const s = fresh();
  // A line (0, 0) → (10, 0) and a circle round (10, 5 + 1e-15): the tangent arc from (10, 0) to (10, 10) leaves along +x, so its
  // centre is on the normal x = 10 and as far from (10, 10) as from (10, 0): (10, 5). The circle's centre is 1e-15 off it.
  let doc = drawLine(s.doc, s.id, [0, 0], [10, 0]).doc;
  doc = drawCircle(doc, s.id, [10, 5 + 1e-15], 1).doc;
  const r = clicks(doc, startTool("tangent", s.id), [[10, 0], [10, 10]]);
  assert.equal(r.drew, 1);
  const sk = r.doc.sketches[0];
  const circle = sk.curves.find((c) => c.kind === "circle")!;
  const arc = sk.curves.find((c) => c.kind === "arc")!;
  assert.equal(arc.kind === "arc" && circle.kind === "circle" && arc.centre === circle.centre, true, JSON.stringify(sk.points));
});

test("hunt-1101-2 boundary: a point 0.9× SAME_PLACE from the tool's own click is not snapped to, 1.1× is", () => {
  for (const [f, offered] of [[0.9, false], [1.1, true]] as const) {
    const s = fresh();
    // A line chain from (10, 0) (the tool's own click, a point id) and a circle round (10 + f·SAME_PLACE, 0).
    let doc = drawLine(s.doc, s.id, [0, 0], [10, 0]).doc;
    doc = drawCircle(doc, s.id, [10 + f * SAME_PLACE, 0], 1).doc;
    const from = doc.sketches[0].points.find((p) => p.x === 10)!.id;
    const t = snapTargets(doc.sketches[0], { kind: "line", sketch: s.id, from });
    assert.equal(t.points.some((p) => p.at[0] === 10 + f * SAME_PLACE), offered, `${f}×`);
  }
});

test("hunt-1101-2 boundary: a rectangle's second corner lines up with no row 0.9× of 2·SAME_PLACE off the first corner's, 1.1× it does", () => {
  for (const [f, offered] of [[0.9, false], [1.1, true]] as const) {
    const s = fresh();
    // A point (20, 2·f·SAME_PLACE); the first corner (0, 0): rows within 2·SAME_PLACE of y = 0 would make the rectangle flat
    // (`flat`), so they are not offered; further off they are.
    const doc = drawCircle(s.doc, s.id, [20, 2 * f * SAME_PLACE], 1).doc;
    const t = snapTargets(doc.sketches[0], { kind: "rectangle", sketch: s.id, corner: [0, 0] });
    assert.equal(t.rows.some((r) => r[1] === 2 * f * SAME_PLACE), offered, `${f}×`);
  }
});

// ---- 3. Under the smallest piece ----

test("hunt-1101-3: a circle from (1, 1) to (1.001, 1) is refused at the click, as the kernel refuses it", async () => {
  const s = fresh();
  // 1.001 is stored as 1.000999999999999889…, so the radius 1.001 − 1 = 0.0009999999999998899, under 0.001: the kernel
  // takes no rounding off a circle's radius and refuses it, so the tool says so instead of drawing it.
  const r = clicks(s.doc, startTool("circle", s.id), [[1, 1], [1.001, 1]]);
  assert.equal(r.drew, 0);
  assert.equal(r.note, SMALL_CIRCLE);
  await assert.rejects(kernel.call("sketch_outline", [], [{ centre: [1, 1], radius: 1.001 - 1 }], []), /radius must be between 0.001/);
});

test("hunt-1101-3 boundary: a circle of radius 0.9× MIN_SIZE is refused, 1.1× and MIN_SIZE itself are drawn", async () => {
  for (const [r, drawn] of [[0.9 * MIN_SIZE, false], [MIN_SIZE, true], [1.1 * MIN_SIZE, true]] as const) {
    const s = fresh();
    const got = clicks(s.doc, startTool("circle", s.id), [[0, 0], [r, 0]]);
    assert.equal(got.drew, drawn ? 1 : 0, `radius ${r}`);
    const said = await kernel.call("sketch_outline", [], [{ centre: [0, 0], radius: r }], []).then(() => true, () => false);
    assert.equal(said, drawn, `the kernel on radius ${r}`);
  }
});

test("hunt-1101-3: a line 0.0009 mm long is refused at the click; (1, 1) to (1.001, 1) is a line, as the kernel says", async () => {
  const s = fresh();
  // 0.0009 mm is under the smallest piece: refused with a note.
  const short = clicks(s.doc, startTool("line", s.id), [[1, 1], [1.0009, 1]]);
  assert.equal(short.drew, 0);
  assert.equal(short.note, SHORT_LINE);
  // 1.001 − 1 = 0.0009999999999998899 is 0.001 up to the rounding of the coordinates it was measured from (the decimals
  // 1 and 1.001 are 0.001 apart): a line, as the kernel takes it.
  const one = clicks(s.doc, startTool("line", s.id), [[1, 1], [1.001, 1]]);
  assert.equal(one.drew, 1);
  const tri = [{ a: [1, 1], b: [1.001, 1] }, { a: [1.001, 1], b: [1, 2] }, { a: [1, 2], b: [1, 1] }] as { a: SketchXY; b: SketchXY }[];
  await kernel.call("sketch_outline", tri, [], []);
});

test("hunt-1101-3 boundary: a line 0.9× MIN_SIZE long is refused, 1.1× is drawn; its rounding allowance at 0.9× and 1.1×", async () => {
  const lineOf = async (a: SketchXY, b: SketchXY) => {
    const s = fresh();
    const tool = clicks(s.doc, startTool("line", s.id), [a, b]);
    const tri = [{ a, b }, { a: b, b: [a[0] - 1, a[1]] as SketchXY }, { a: [a[0] - 1, a[1]] as SketchXY, b: a }];
    const said = await kernel.call("sketch_outline", tri, [], []).then(() => true, (e) => !/must be between/.test(String(e)));
    return { drew: tool.drew === 1, said };
  };
  assert.deepEqual(await lineOf([0, 0], [0, 0.9 * MIN_SIZE]), { drew: false, said: false });
  assert.deepEqual(await lineOf([0, 0], [0, 1.1 * MIN_SIZE]), { drew: true, said: true });
  // The allowance is 4 roundings of the largest coordinate, M = 1000: 4·ε·1000 ≈ 8.9e-13 mm. Lengths MIN_SIZE less 0.9× and
  // 1.1× of it, measured along y from (1000, 0) so the length itself is exact: the first is a line, the second is not.
  const allow = 4 * Number.EPSILON * 1000;
  assert.deepEqual(await lineOf([1000, 0], [1000, MIN_SIZE - 0.9 * allow]), { drew: true, said: true });
  assert.deepEqual(await lineOf([1000, 0], [1000, MIN_SIZE - 1.1 * allow]), { drew: false, said: false });
});

// ---- 4. A second click on the tool's own click ----

test("hunt-1101-4: a double-click on a point a chain started on draws nothing (no stub to where the pointer is)", () => {
  const s = fresh();
  const doc = drawLine(s.doc, s.id, [10, 0], [20, 5]).doc;
  // Pixel 0.01 mm: reach 10 px = 0.1 mm. The pointer at (10.03, 0.02) is √(0.03² + 0.02²) = √0.0013 ≈ 0.036 mm from the point
  // (10, 0), in reach: the first click lands on it (the chain starts there), and so does the second, on the chain's own
  // start, so nothing is drawn. Before the fix the second landed on the pointer itself, a 0.036 mm stub.
  let tool: SketchTool = startTool("line", s.id);
  let d = doc;
  for (let k = 0; k < 2; k++) {
    const snap = snapOnSketch(d, tool, [10.03, 0.02], [10.03, 0.02], 0.01);
    assert.deepEqual(snap.at, [10, 0], `click ${k + 1}`);
    const r = clickAt(d, tool, snap.at);
    assert.equal(r.drew, false, `click ${k + 1} drew`);
    [d, tool] = [r.doc, r.tool];
  }
});

test("hunt-1101-4: a double-click ending a line on the x axis draws one line, not a stub after it", () => {
  const s = fresh();
  // Pixel 0.01 mm, reach 0.1 mm. The chain starts at (5, 5) (a click there, nothing near). The pointer at (20.03, 0.02) is
  // 0.02 off y = 0, the x axis: the first click lands on (20.03, 0), drawing (5, 5) → (20.03, 0), and the chain goes on
  // from (20.03, 0). The second click, the pointer not moved, is 0.02 mm from that, the chain's own point: nothing more.
  let doc = s.doc;
  let tool: SketchTool = startTool("line", s.id);
  for (const raw of [[5, 5], [20.03, 0.02], [20.03, 0.02]] as SketchXY[]) {
    const r = clickAt(doc, tool, snapOnSketch(doc, tool, raw, raw, 0.01).at);
    [doc, tool] = [r.doc, r.tool];
  }
  assert.deepEqual(sketchCurves(doc.sketches[0]).lines, [{ a: [5, 5], b: [20.03, 0] }]);
});

test("hunt-1101-4 boundary: the pointer 0.9× the reach from the tool's own click lands on it, 1.1× does not", () => {
  const s = fresh();
  // The chain's first click at (10, 10), a new point; pixel 0.01 mm, reach 0.1 mm; the pointer straight above it.
  const tool: SketchTool = clickAt(s.doc, startTool("line", s.id), [10, 10]).tool;
  const reach = SNAP_PIXELS * 0.01;
  const near: SketchXY = [10, 10 + 0.9 * reach];
  const far: SketchXY = [10, 10 + 1.1 * reach];
  assert.deepEqual(snapOnSketch(s.doc, tool, near, near, 0.01).at, [10, 10]);
  assert.notDeepEqual(snapOnSketch(s.doc, tool, far, far, 0.01).at, [10, 10]);
});

test("hunt-1101-4: a sketch point nearer the pointer than the tool's own click is the one taken", () => {
  const s = fresh();
  // The chain from (10, 10); a circle's centre at (10.05, 10). Reach 0.1 mm. The pointer at (10.04, 10) is 0.04 from the
  // chain's point and 0.01 from the centre: the centre, nearer, is where it lands.
  const doc = drawCircle(s.doc, s.id, [10.05, 10], 1).doc;
  const tool: SketchTool = clickAt(doc, startTool("line", s.id), [10, 10]).tool;
  assert.deepEqual(snapOnSketch(doc, tool, [10.04, 10], [10.04, 10], 0.01).at, [10.05, 10]);
});

// ---- 5. A rectangle under the smallest piece ----

test("hunt-1101-5: a rectangle 0.0009 mm wide is refused with a note; the kernel refuses its sides too", async () => {
  const s = fresh();
  // Corners (0, 0) and (0.0009, 5): its bottom and top sides are 0.0009 mm long, under 0.001.
  const r = clicks(s.doc, startTool("rectangle", s.id), [[0, 0], [0.0009, 5]]);
  assert.equal(r.drew, 0);
  assert.equal(r.note, SMALL_RECTANGLE);
  const box = (w: number, h: number) => [{ a: [0, 0], b: [w, 0] }, { a: [w, 0], b: [w, h] }, { a: [w, h], b: [0, h] }, { a: [0, h], b: [0, 0] }] as { a: SketchXY; b: SketchXY }[];
  await assert.rejects(kernel.call("sketch_outline", box(0.0009, 5), [], []), /must be between 0.001/);
});

test("hunt-1101-5 boundary: a rectangle 0.9× MIN_SIZE wide or high is refused, 1.1× is drawn, as the kernel says", async () => {
  const kernelSays = async (a: SketchXY, c: SketchXY) => {
    const k: SketchXY[] = [a, [c[0], a[1]], c, [a[0], c[1]]];
    return kernel.call("sketch_outline", k.map((p, i) => ({ a: p, b: k[(i + 1) % 4] })), [], []).then(() => true, (e) => !/must be between/.test(String(e)));
  };
  const allow = 4 * Number.EPSILON * 1000;
  // Wide or high by f·MIN_SIZE from (0, 0) the other side 5 mm; and at y from (1000, 0), 1 mm wide, high by MIN_SIZE less 0.9× or
  // 1.1× the lines' rounding allowance (4·ε·1000), the height exact as it is measured along y.
  const cases: [SketchXY, SketchXY, boolean][] = [
    [[0, 0], [0.9 * MIN_SIZE, 5], false],
    [[0, 0], [1.1 * MIN_SIZE, 5], true],
    [[0, 0], [5, 0.9 * MIN_SIZE], false],
    [[0, 0], [5, 1.1 * MIN_SIZE], true],
    [[1000, 0], [1001, MIN_SIZE - 0.9 * allow], true],
    [[1000, 0], [1001, MIN_SIZE - 1.1 * allow], false],
  ];
  for (const [a, c, ok] of cases) {
    const s = fresh();
    const r = clicks(s.doc, startTool("rectangle", s.id), [a, c]);
    assert.equal(r.drew, ok ? 1 : 0, `${a} → ${c}: ${r.note}`);
    assert.equal(await kernelSays(a, c), ok, `the kernel on ${a} → ${c}`);
  }
});
