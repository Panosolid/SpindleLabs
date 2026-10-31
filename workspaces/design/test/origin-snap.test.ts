// Snapping to the sketch's origin and axes (snap.ts, Ben's ask 10-31): the
// sketch's (0, 0) is a point to snap to after every other point, and its x
// axis (y = 0) and y axis (x = 0) are a row and a column to line up with
// after every other. Hand-worked cases with the sums shown, the reach's
// 0.9× / 1.1× boundary for the origin and each axis, what wins where they
// meet other snaps (a sketch point, a body corner, a body edge, another
// point's column, the tool's own clicks, the rectangle's first corner),
// the origin's mark, and why a face sketch's (0, 0) is the world's origin
// seen square on. The seeded random check against a model is in
// snap.test.ts, whose model has the origin and axes too.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawLine } from "../src/sketch.ts";
import type { LineTool, RectangleTool } from "../src/sketch-tool.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { inSketch } from "../src/face-edges.ts";
import { SNAP_HELP } from "../src/sketch-panel.ts";
import { MARK_PIXELS, ORIGIN, SNAP_PIXELS, snapLabel, snapMarks, snapOnSketch, snapsNow, snapTargets } from "../src/snap.ts";

function blank() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return { doc: s.doc, sketch: s.id };
}
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const line = (sketch: string, from: LineTool["from"] = null): LineTool => ({ kind: "line", sketch, from });

test("hand-worked: near (0, 0) an empty sketch snaps to its origin, exactly", () => {
  const { doc, sketch } = blank();
  // Pixel 0.5 mm: reach 5 mm. (3, 4) is √(9 + 16) = 5 from (0, 0), at the reach: the origin, not the grid's (0, 10).
  const s = snapOnSketch(doc, line(sketch), [3, 4], [0, 10], 0.5);
  assert.deepEqual(s, { kind: "origin", at: [0, 0] });
  assert.equal(snapLabel(s), "origin 0,0");
});

test("hand-worked: near the x axis it lands on it, near the y axis on that, x or y from the rounded point", () => {
  const { doc, sketch } = blank();
  // Reach 5 mm. (12, 1.5): 1.5 off y = 0, 12 off x = 0, √(144 + 2.25) ≈ 12.1 from (0, 0): on the x axis, x the rounded 12.
  const x = snapOnSketch(doc, line(sketch), [12, 1.5], [12, 1.5], 0.5);
  assert.deepEqual(x, { kind: "aligned", at: [12, 0], column: null, row: [0, 0] });
  assert.equal(snapLabel(x), "on x axis");
  // (−1.5, 22) with the grid's (0, 20): 1.5 off x = 0, so x is 0; y the grid's 20.
  const y = snapOnSketch(doc, line(sketch), [-1.5, 22], [0, 20], 0.5);
  assert.deepEqual(y, { kind: "aligned", at: [0, 20], column: [0, 0], row: null });
  assert.equal(snapLabel(y), "on y axis");
});

test("hand-worked: where the x axis crosses another point's column, the pointer lands on the crossing", () => {
  const { doc, sketch } = blank();
  const d = drawLine(doc, sketch, [10, 30], [25, 30]).doc;
  // Reach 5 mm. (10.8, 1.2): 0.8 off x = 10 (the point (10, 30)), 1.2 off y = 0 (the x axis), 28.8 or more from every
  // point: x from the column, y from the axis, (10, 0) — under (10, 30) on the axis.
  const s = snapOnSketch(d, line(sketch), [10.8, 1.2], [10.8, 1.2], 0.5);
  assert.deepEqual(s, { kind: "aligned", at: [10, 0], column: [10, 30], row: [0, 0] });
  assert.equal(snapLabel(s), "vertical from 10,30 and on x axis");
});

test("a nearer point's row wins over the x axis: the axis is one more line-up, not a stronger one", () => {
  const { doc, sketch } = blank();
  const d = drawLine(doc, sketch, [30, 3], [40, 3]).doc;
  // Reach 5 mm. (12, 2): 2 off y = 0, 1 off y = 3 (the line's row): the nearer row, y = 3.
  assert.deepEqual(snapOnSketch(d, line(sketch), [12, 2], [12, 2], 0.5), { kind: "aligned", at: [12, 3], column: null, row: [30, 3] });
});

test("the reach's boundary: 0.9× snaps and 1.1× does not, for the origin and for each axis", () => {
  const { doc, sketch } = blank();
  const pixel = 0.25; // reach 2.5 mm
  const r = SNAP_PIXELS * pixel;
  const snap = (p: SketchXY) => snapOnSketch(doc, line(sketch), p, p, pixel);
  // Within reach of both axes is lining up with the origin's column and row both: the origin (as for any point).
  assert.deepEqual(snap([0.9 * r, 0.9 * r]), { kind: "origin", at: [0, 0] });
  // Out of the y axis's reach, in the x axis's: on the x axis at the pointer's x.
  assert.deepEqual(snap([1.1 * r, 0.9 * r]), { kind: "aligned", at: [1.1 * r, 0], column: null, row: [0, 0] });
  assert.deepEqual(snap([0.9 * r, 1.1 * r]), { kind: "aligned", at: [0, 1.1 * r], column: [0, 0], row: null });
  // Far along each axis: 0.9 reaches off it lands on it, 1.1 off does not.
  assert.equal(snapLabel(snap([40, 0.9 * r])), "on x axis");
  assert.deepEqual(snap([40, 1.1 * r]), { kind: "grid", at: [40, 1.1 * r] });
  assert.equal(snapLabel(snap([-0.9 * r, -40])), "on y axis");
  assert.deepEqual(snap([-1.1 * r, -40]), { kind: "grid", at: [-1.1 * r, -40] });
});

test("a sketch point at (0, 0) is the one taken there, and so is a body corner, which pins", () => {
  const { doc, sketch } = blank();
  const d = drawLine(doc, sketch, [0, 0], [20, 0]).doc;
  assert.deepEqual(snapOnSketch(d, line(sketch), [0.2, 0.1], [0, 0], 0.1), { kind: "endpoint", at: [0, 0] });
  // A box's corner at the origin (a sketch on XY under a box from (0, 0, 0)): the corner, listed before the origin, so it pins.
  const corner = { at: [0, 0] as SketchXY, kind: "endpoint" as const, name: "c", feature: "feature-1" };
  assert.deepEqual(snapOnSketch(doc, line(sketch), [0.2, 0.1], [0, 0], 0.1, [corner]), { kind: "endpoint", at: [0, 0], edge: true });
});

test("a body edge part way along wins over an axis, as an edge wins over lining up", () => {
  const { doc, sketch } = blank();
  // Reach 5 mm. An edge x = 3 from (3, −10) to (3, 10); the pointer (2.5, 8) is 0.5 from it, 2.5 off the y axis and √(6.25 + 64) ≈ 8.4 from the origin: on the edge at (3, 8).
  const body = { curves: [{ kind: "line" as const, a: [3, -10] as SketchXY, b: [3, 10] as SketchXY }], corners: [] };
  assert.deepEqual(snapOnSketch(doc, line(sketch), [2.5, 8], [2.5, 8], 0.5, [], body), { kind: "on", at: [3, 8] });
});

test("the tool's own click on the origin is never a target, and lining up onto it is not a snap", () => {
  const { doc, sketch } = blank();
  // A chain started at (0, 0): the origin is left out of the points (a click there draws nothing).
  const t = snapTargets(sketchOf(doc, sketch), line(sketch, [0, 0]));
  assert.ok(!t.points.some((p) => p.kind === "origin"));
  // (1, 1) at reach 5: on both axes' line-ups, which meet at the chain's own point: the grid's point, not a snap.
  assert.deepEqual(snapOnSketch(doc, line(sketch, [0, 0]), [1, 1], [1, 1], 0.5), { kind: "grid", at: [1, 1] });
  // Away from the origin, the axes still line the chain up: (12, 1) is horizontal along the x axis.
  assert.deepEqual(snapOnSketch(doc, line(sketch, [0, 0]), [12, 1], [12, 1], 0.5), { kind: "aligned", at: [12, 0], column: null, row: [0, 0] });
});

test("a rectangle's second corner never lines up on the first corner's axis: it would draw nothing", () => {
  const { doc, sketch } = blank();
  const rect: RectangleTool = { kind: "rectangle", sketch, corner: [0, 7] };
  const t = snapTargets(sketchOf(doc, sketch), rect);
  // The first corner is on the y axis (x = 0): that column is offered by nothing; the x axis (y = 0 ≠ 7) still is.
  assert.ok(!t.columns.some((c) => c[0] === 0));
  assert.ok(t.rows.some((r) => r[0] === 0 && r[1] === 0));
  assert.deepEqual(snapOnSketch(doc, rect, [1, 20], [1, 20], 0.5), { kind: "grid", at: [1, 20] });
  assert.deepEqual(snapOnSketch(doc, rect, [20, 1], [20, 1], 0.5), { kind: "aligned", at: [20, 0], column: null, row: [0, 0] });
});

test("snapping off (Ctrl held or the Snap button) leaves the origin and axes alone too", () => {
  const { doc, sketch } = blank();
  assert.deepEqual(snapOnSketch(doc, line(sketch), [0.1, 0.1], [0.1, 0.1], 0.1, [], undefined, snapsNow(true, true, false).points), { kind: "grid", at: [0.1, 0.1] });
  assert.deepEqual(snapOnSketch(doc, line(sketch), [12, 0.1], [12, 0.1], 0.1, [], undefined, snapsNow(false, false, false).points), { kind: "grid", at: [12, 0.1] });
});

test("hand-worked: the origin's mark is the centre's ring with a cross through it, MARK_PIXELS out", () => {
  const px = 0.5;
  const m = MARK_PIXELS * px; // 3.5 mm
  const marks = snapMarks({ kind: "origin", at: [0, 0] }, px);
  // 16 ring segments, then the cross: (−3.5, 0) → (3.5, 0) and (0, −3.5) → (0, 3.5).
  assert.equal(marks.length, 18);
  assert.deepEqual(marks.slice(16), [[[-m, 0], [m, 0]], [[0, -m], [0, m]]]);
  for (const [a] of marks.slice(0, 16)) assert.ok(Math.abs(Math.hypot(a[0], a[1]) - m) < 1e-12, `${a} is on the ring`);
  assert.deepEqual(snapMarks({ kind: "centre", at: [0, 0] }, px), marks.slice(0, 16));
});

test("hand-worked: on a slanted face the sketch's (0, 0) is the world's origin seen square on, and its x axis the world's x axis", () => {
  // Outward normal n = (0, 0.6, 0.8) through (5, 7, 9): n · p = 4.2 + 7.2 = 11.4, so the frame's origin is 11.4 n, the
  // plane's nearest point to (0, 0, 0). x stays (1, 0, 0) (already square to n), y = n × x = (0, 0.8, −0.6).
  const { plane } = drawnFrame([0, 0.6, 0.8], [5, 7, 9]);
  const o = inSketch([0, 0, 0], plane);
  assert.ok(Math.abs(o[0]) < 1e-12 && Math.abs(o[1]) < 1e-12, `the world's origin is at ${o}`);
  // (12, 0, 0) − 11.4 n has x 12 and y −11.4 (n · y) = −11.4 (0.48 − 0.48) = 0: (12, 0), on the sketch's x axis.
  const x = inSketch([12, 0, 0], plane);
  assert.ok(Math.abs(x[0] - 12) < 1e-12 && Math.abs(x[1]) < 1e-12, `(12, 0, 0) is at ${x}`);
  assert.deepEqual(ORIGIN, [0, 0]);
});

test("the sketch panel's help says points snap to the origin and along the axes", () => {
  assert.match(SNAP_HELP, /to the origin and along the red and green axes/);
});
