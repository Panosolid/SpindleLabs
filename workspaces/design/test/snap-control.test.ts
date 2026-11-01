// Snapping control (the snapping thread, 10-28): snapping turned off by
// holding Ctrl or Cmd or by the Snap button (`snapsNow`), landing on a body
// edge part way along it (`nearestOn`, "on edge"), and lining up with the
// bodies' corners in the sketch's plane (face-edges.ts `sketchPlaneCorners`,
// projection.ts `sketchEdgeCurves`). Hand-worked cases with the working
// shown, the reach's 0.9× / 1.1× boundary for edges, a planted break, and
// a seeded comparison with a brute-force search along each edge.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plane, SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { addFaceSketch, addSketch, drawLine } from "../src/sketch.ts";
import { startTool } from "../src/sketch-tool.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { sketchPlaneCorners } from "../src/face-edges.ts";
import { sketchEdgeCurves } from "../src/projection.ts";
import { nameBody } from "../src/naming.ts";
import { nearestOn, SNAP_PIXELS, snapLabel, snapMarks, snapOnSketch, snapPointer, snapsNow, snapTargets, type EdgeCurve, type SnapTargets } from "../src/snap.ts";
import { boxView, cylinderView, onlyBody } from "./views.ts";

const plane = (origin: number[], xAxis: number[], normal: number[]): Plane => ({ origin: origin as Plane["origin"], xAxis: xAxis as Plane["xAxis"], normal: normal as Plane["normal"] });
const TOP = plane([0, 0, 20], [1, 0, 0], [0, 0, 1]);
const box = () => {
  const view = boxView(40, 30, 20);
  return { view, names: nameBody("feature-1", view, () => null) };
};
/** A sketch on the 40 × 30 × 20 box's top with nothing drawn, and its id. */
function onTop(): { doc: DesignDocument; id: string } {
  return addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
}
/** Only these edges to land on: no points, no columns or rows. */
const onlyCurves = (curves: EdgeCurve[], own: SketchXY[] = []): SnapTargets => ({ points: [], columns: [], rows: [], own, curves });
const near = (a: SketchXY, b: SketchXY, tol = 1e-12) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

// ---- What snaps (snapsNow) ----

test("hand-worked: Ctrl or Cmd held turns every snap and the grid off; the Snap button off turns the snaps off and leaves the grid to its tick box", () => {
  // Every one of the 8 cases, by the rule: points snap only with the button on and nothing held; the grid only when ticked and nothing held.
  const table: [boolean, boolean, boolean, { points: boolean; grid: boolean }][] = [
    [true, false, false, { points: true, grid: false }],
    [true, false, true, { points: true, grid: true }],
    [true, true, false, { points: false, grid: false }],
    [true, true, true, { points: false, grid: false }],
    [false, false, false, { points: false, grid: false }],
    [false, false, true, { points: false, grid: true }],
    [false, true, false, { points: false, grid: false }],
    [false, true, true, { points: false, grid: false }],
  ];
  for (const [on, held, grid, want] of table) assert.deepEqual(snapsNow(on, held, grid), want, `snap ${on}, held ${held}, grid ${grid}`);
});

test("with snapping off, the pointer lands on the rounded point even on top of a sketch point and a body corner", () => {
  const { doc, id } = onTop();
  const drawn = drawLine(doc, id, [10, 10], [20, 10]).doc;
  const tool = startTool("line", id);
  const corner = { at: [40, 30] as SketchXY, kind: "endpoint" as const, name: "c", feature: "feature-1" };
  // 0.05 mm from the sketch's end (10, 10) with 0.1 mm pixels: on, it snaps there; off, it stays where it was rounded to.
  assert.deepEqual(snapOnSketch(drawn, tool, [10.05, 10], [10.05, 10], 0.1, [corner]), { kind: "endpoint", at: [10, 10] });
  assert.deepEqual(snapOnSketch(drawn, tool, [10.05, 10], [10.05, 10], 0.1, [corner], undefined, false), { kind: "grid", at: [10.05, 10] });
  assert.deepEqual(snapOnSketch(drawn, tool, [40.05, 30], [40.05, 30], 0.1, [corner], undefined, false), { kind: "grid", at: [40.05, 30] });
  assert.deepEqual(snapOnSketch(drawn, tool, [40.05, 30], [40.05, 30], 0.1, [corner]), { kind: "endpoint", at: [40, 30], edge: true });
});

// ---- The nearest point on an edge (nearestOn) ----

test("hand-worked: the nearest point on a line, a circle and an arc", () => {
  // Line (0, 0) → (10, 0); from (3, 4) the perpendicular drops straight down to (3, 0).
  assert.deepEqual(nearestOn({ kind: "line", a: [0, 0], b: [10, 0] }, [3, 4]), [3, 0]);
  // Past the start, (−2, 1): t = (−2·10)/100 < 0, clamped to the start itself (0, 0); past the end, (12, −1): the end.
  assert.deepEqual(nearestOn({ kind: "line", a: [0, 0], b: [10, 0] }, [-2, 1]), [0, 0]);
  assert.deepEqual(nearestOn({ kind: "line", a: [0, 0], b: [10, 0] }, [12, -1]), [10, 0]);
  // A slanted line (0, 0) → (4, 4), from (4, 0): t = (4·4)/(16 + 16) = 1/2, so (2, 2) (the diagonal's foot, by symmetry).
  assert.deepEqual(nearestOn({ kind: "line", a: [0, 0], b: [4, 4] }, [4, 0]), [2, 2]);
  // Circle of radius 5 round (0, 0); from (6, 8), 10 away: 5/10 of the way out, (3, 4) (a 3-4-5 triangle).
  assert.deepEqual(nearestOn({ kind: "circle", centre: [0, 0], radius: 5 }, [6, 8]), [3, 4]);
  // From inside, (0.6, 0.8), 1 away: (3, 4) again, the same ray.
  assert.ok(near(nearestOn({ kind: "circle", centre: [0, 0], radius: 5 }, [0.6, 0.8])!, [3, 4]));
  // On the centre there is no nearest point.
  assert.equal(nearestOn({ kind: "circle", centre: [0, 0], radius: 5 }, [0, 0]), null);
  // The quarter arc counter-clockwise from (5, 0) to (0, 5): (6, 8) is within its sweep (53°), so (3, 4); (−6, −8) is not (233°), none.
  const quarter: EdgeCurve = { kind: "arc", start: [5, 0], end: [0, 5], centre: [0, 0] };
  assert.deepEqual(nearestOn(quarter, [6, 8]), [3, 4]);
  assert.equal(nearestOn(quarter, [-6, -8]), null);
  // The other three quarters, counter-clockwise from (0, 5) round to (5, 0): (−6, −8) is on it, (6, 8) is not.
  const rest: EdgeCurve = { kind: "arc", start: [0, 5], end: [5, 0], centre: [0, 0] };
  assert.deepEqual(nearestOn(rest, [-6, -8]), [-3, -4]);
  assert.equal(nearestOn(rest, [6, 8]), null);
});

// ---- Landing on an edge (snapPointer) ----

const BOTTOM: EdgeCurve = { kind: "line", a: [0, 0], b: [40, 0] };

test("the pointer lands on a body edge within SNAP_PIXELS: 0.9 × the reach off it does, 1.1 × doesn't", () => {
  // Pixels 0.1 mm wide: the reach is SNAP_PIXELS · 0.1 = 1 mm. (13, 0.9) is 0.9 mm above the edge y = 0: on it at (13, 0).
  const reach = SNAP_PIXELS * 0.1;
  const on = snapPointer([13, 0.9 * reach], [13, 0.9], onlyCurves([BOTTOM]), 0.1);
  assert.deepEqual(on, { kind: "on", at: [13, 0] });
  assert.equal(snapLabel(on), "on edge 13,0");
  assert.deepEqual(snapPointer([13, 1.1 * reach], [13, 1.1], onlyCurves([BOTTOM]), 0.1), { kind: "grid", at: [13, 1.1] });
  // The same 0.9 / 1.1 off a circle of radius 10: the rim's nearest point is on the ray, 10 out.
  const circle: EdgeCurve = { kind: "circle", centre: [0, 0], radius: 10 };
  assert.equal(snapPointer([0, 10 + 0.9 * reach], [0, 10.9], onlyCurves([circle]), 0.1).kind, "on");
  assert.equal(snapPointer([0, 10 + 1.1 * reach], [0, 11.1], onlyCurves([circle]), 0.1).kind, "grid");
});

test("a point within reach beats an edge, an edge beats lining up, and an edge point on the tool's own click is never landed on", () => {
  const corner = { at: [40, 0] as SketchXY, kind: "endpoint" as const };
  const t: SnapTargets = { points: [corner], columns: [[13.5, 50]], rows: [], own: [], curves: [BOTTOM] };
  // 0.6 mm from the corner (40, 0) and 0.5 mm off the edge: the corner wins, though the edge is nearer.
  assert.deepEqual(snapPointer([39.6, 0.5], [39.6, 0.5], t, 0.1), { kind: "endpoint", at: [40, 0] });
  // (13, 0.5): on the edge at (13, 0), though the column x = 13.5 is in reach too.
  assert.deepEqual(snapPointer([13, 0.5], [13, 0.5], t, 0.1), { kind: "on", at: [13, 0] });
  // The tool's first click at (13, 0), 0.5 from the pointer, in reach: landed on exactly (a second click there draws
  // nothing; hunt 2026-11-01), before the edge.
  assert.deepEqual(snapPointer([13, 0.5], [13, 0.5], { ...t, own: [[13, 0]] }, 0.1), { kind: "grid", at: [13, 0] });
  // From (13.45, 0.95), √(0.45² + 0.95²) ≈ 1.05 from it, out of reach, with grid snap's (13, 1): the edge is 0.95 away, in
  // reach, but its point at the grid point's foot is (13, 0), the tool's own click, so the edge doesn't offer it; the
  // column x = 13.5 (0.05 off) does, at the grid's y.
  assert.deepEqual(snapPointer([13.45, 0.95], [13, 1], { ...t, own: [[13, 0]] }, 0.1), { kind: "aligned", at: [13.5, 1], column: [13.5, 50], row: null });
});

test("on an edge the point is the rounded point's foot, so a free click reads as rounded along the edge", () => {
  // The pointer at (13.0004, 0.5) is rounded to (13, 0.5) (place_freely, 0.001 mm here); the foot of that on y = 0 is (13, 0), not (13.0004, 0).
  assert.deepEqual(snapPointer([13.0004, 0.5], [13, 0.5], onlyCurves([BOTTOM]), 0.1), { kind: "on", at: [13, 0] });
  // Which edge is the pointer's own nearest: from (5, 0.7) the edge y = 0 (0.7 away) beats y = 1.5 (0.8), though the rounded (5, 0.8) is midway.
  const upper: EdgeCurve = { kind: "line", a: [0, 1.5], b: [40, 1.5] };
  assert.deepEqual(snapPointer([5, 0.7], [5, 0.8], onlyCurves([BOTTOM, upper]), 0.1), { kind: "on", at: [5, 0] });
});

test("of two edges in reach, the nearer is landed on", () => {
  // Edges y = 0 and y = 1.5; from (5, 0.9) the first is 0.9 away, the second 0.6: (5, 1.5).
  const upper: EdgeCurve = { kind: "line", a: [0, 1.5], b: [40, 1.5] };
  assert.deepEqual(snapPointer([5, 0.9], [5, 0.9], onlyCurves([BOTTOM, upper]), 0.1), { kind: "on", at: [5, 1.5] });
  assert.deepEqual(snapPointer([5, 0.6], [5, 0.6], onlyCurves([BOTTOM, upper]), 0.1), { kind: "on", at: [5, 0] });
});

test("an edge's mark is a diamond MARK_PIXELS out round the point", () => {
  // Pixel 0.1 mm: m = 7 · 0.1 = 0.7 mm; the diamond's corners are (13, ±0.7) and (13 ± 0.7, 0), joined in turn.
  const marks = snapMarks({ kind: "on", at: [13, 0] }, 0.1);
  assert.equal(marks.length, 4);
  const corners = marks.map(([a]) => a);
  for (const want of [[13, -0.7], [13.7, 0], [13, 0.7], [12.3, 0]] as SketchXY[]) assert.ok(corners.some((c) => near(c, want, 1e-12)), `corner ${want}`);
});

test("planted break: an edge snap that forgets to clamp to the line's ends would land past them; the clamp is what stops it", () => {
  // The unclamped foot from (45, 0.5) is (45, 0), 5 mm past the end (40, 0). The real one is the end itself, then 5.02 mm
  // away, out of reach, so nothing is landed on. Proved both ways: the planted version (no clamp) does land, ours doesn't.
  const unclamped = (c: { a: SketchXY; b: SketchXY }, p: SketchXY): SketchXY => {
    const [dx, dy] = [c.b[0] - c.a[0], c.b[1] - c.a[1]];
    const t = ((p[0] - c.a[0]) * dx + (p[1] - c.a[1]) * dy) / (dx * dx + dy * dy);
    return [c.a[0] + t * dx, c.a[1] + t * dy];
  };
  assert.deepEqual(unclamped(BOTTOM as { a: SketchXY; b: SketchXY }, [45, 0.5]), [45, 0]);
  assert.deepEqual(nearestOn(BOTTOM, [45, 0.5]), [40, 0]);
  assert.equal(snapPointer([45, 0.5], [45, 0.5], onlyCurves([BOTTOM]), 0.1).kind, "grid");
});

// ---- What bodies offer (sketchEdgeCurves, sketchPlaneCorners) ----

test("hand-worked: a sketch on the box's top lands on its 8 flat edges, and lines up with its 4 top corners but not the bottom ones", () => {
  const { view, names } = box();
  const scene = onlyBody(view, names);
  const { doc, id } = onTop();
  // 12 edges: 4 round the top and 4 round the bottom are lines from above; the 4 uprights are seen end on, points, left out.
  const curves = sketchEdgeCurves(doc, id, scene, TOP);
  assert.equal(curves.length, 8);
  assert.ok(curves.every((c) => c.kind === "line"));
  // Corners: the top's 4 (z = 20, on the plane); the bottom's 4 are 20 mm below it and line nothing up.
  const corners = sketchPlaneCorners(doc, id, scene, TOP).map((p) => `${p}`).sort();
  assert.deepEqual(corners, ["0,0", "0,30", "40,0", "40,30"]);
  // A plane at z = 5 holds no corner of the box: nothing to line up with, but the edges are still seen from it.
  const mid = plane([0, 0, 5], [1, 0, 0], [0, 0, 1]);
  assert.deepEqual(sketchPlaneCorners(doc, id, scene, mid), []);
  assert.equal(sketchEdgeCurves(doc, id, scene, mid).length, 8);
  // On the top, 0.5 mm in from the right edge's middle part: on the edge x = 40. Level with the corner (40, 30), 5 mm right of it: lined up.
  const t = snapTargets(doc.sketches.find((s) => s.id === id)!, startTool("line", id), [], { curves, corners: sketchPlaneCorners(doc, id, scene, TOP) });
  assert.deepEqual(snapPointer([39.5, 7], [39.5, 7], t, 0.1), { kind: "on", at: [40, 7] });
  const level = snapPointer([45, 30.05], [45, 30.05], t, 0.1);
  assert.equal(level.kind, "aligned");
  assert.deepEqual(level.at, [45, 30]);
});

test("none offered with no scene, no frame, or for a sketch before the body", () => {
  const { view, names } = box();
  const scene = onlyBody(view, names);
  const { doc, id } = onTop();
  assert.deepEqual(sketchEdgeCurves(doc, id, null, TOP), []);
  assert.deepEqual(sketchEdgeCurves(doc, id, scene, undefined), []);
  assert.deepEqual(sketchPlaneCorners(doc, id, null, TOP), []);
  // A sketch on XY added after the box sees it; the same body named as a feature after the sketch is not offered.
  const xy = addSketch(doc);
  const ground = plane([0, 0, 0], [1, 0, 0], [0, 0, 1]);
  assert.equal(sketchEdgeCurves(xy.doc, xy.id, scene, ground).length, 8);
  assert.equal(sketchPlaneCorners(xy.doc, xy.id, scene, ground).length, 4, "the bottom's 4 corners lie on XY");
  const later = onlyBody(view, { ...names, feature: "feature-99" });
  assert.deepEqual(sketchEdgeCurves(xy.doc, xy.id, later, ground), []);
});

test("hand-worked: a cylinder's rims from its top are circles of its radius to land on", () => {
  // The kernel's exact plane normals and centroids of the two caps (the test view leaves them out): bottom −Z, top +Z.
  const view = { ...cylinderView(10, 20), face_normals: [[0, 0, -1], [0, 0, 1], null], face_centroids: [[0, 0, 0], [0, 0, 20], [0, 0, 10]] } as ReturnType<typeof cylinderView>;
  const scene = onlyBody(view, nameBody("feature-1", view, () => null));
  const { doc, id } = onTop();
  const curves = sketchEdgeCurves(doc, id, scene, TOP);
  assert.equal(curves.length, 2, "the top rim, and the bottom one under it");
  assert.ok(curves.every((c) => c.kind === "circle" && c.radius === 10 && c.centre[0] === 0 && c.centre[1] === 0), JSON.stringify(curves));
  // From (6.3, 8.4), 10.5 from the axis: on the rim at 10/10.5 of the way, (6, 8).
  const s = snapPointer([6.3, 8.4], [6.3, 8.4], onlyCurves(curves), 0.1);
  assert.equal(s.kind, "on");
  assert.ok(near(s.at, [6, 8], 1e-12), `${s.at}`);
});

// ---- Seeded: against a brute-force search along each edge ----

/** Mulberry32, so a failing case replays from its seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points along `c` (ends left out of an arc: its ends are points to snap to, never "on edge"), dense enough that the nearest is within `step` of the true one. */
function samples(c: EdgeCurve, n: number): SketchXY[] {
  if (c.kind === "line") return Array.from({ length: n + 1 }, (_, k): SketchXY => [c.a[0] + ((c.b[0] - c.a[0]) * k) / n, c.a[1] + ((c.b[1] - c.a[1]) * k) / n]);
  const r = c.kind === "circle" ? c.radius : Math.hypot(c.start[0] - c.centre[0], c.start[1] - c.centre[1]);
  const a0 = c.kind === "circle" ? 0 : Math.atan2(c.start[1] - c.centre[1], c.start[0] - c.centre[0]);
  let sweep = c.kind === "circle" ? 2 * Math.PI : Math.atan2(c.end[1] - c.centre[1], c.end[0] - c.centre[0]) - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, k): SketchXY => [c.centre[0] + r * Math.cos(a0 + (sweep * k) / n), c.centre[1] + r * Math.sin(a0 + (sweep * k) / n)]);
}

test("seeded: 3,000 random edges and pointers land where a brute-force search along the edges says, exactly on an edge", () => {
  const seed = Number(process.env.FISSION_SEED ?? 20261028);
  const random = rng(seed);
  const coord = () => (random() * 2 - 1) * 50;
  const N = 20000;
  let landed = 0;
  let missed = 0;
  for (let i = 0; i < 3000; i++) {
    const kind = random();
    const c: EdgeCurve =
      kind < 0.4
        ? { kind: "line", a: [coord(), coord()], b: [coord(), coord()] }
        : kind < 0.7
          ? { kind: "circle", centre: [coord(), coord()], radius: 1 + random() * 30 }
          : (() => {
              const centre: SketchXY = [coord(), coord()];
              const r = 1 + random() * 30;
              const [a, b] = [random() * 2 * Math.PI, random() * 2 * Math.PI];
              return { kind: "arc", centre, start: [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)], end: [centre[0] + r * Math.cos(b), centre[1] + r * Math.sin(b)] };
            })();
    const pixel = 0.05 + random() * 0.3;
    const reach = SNAP_PIXELS * pixel;
    // A pointer near a random sample of the edge (so many land), or anywhere.
    const pts = samples(c, N);
    const base = pts[Math.floor(random() * pts.length)];
    const raw: SketchXY = random() < 0.8 ? [base[0] + (random() * 2 - 1) * 2 * reach, base[1] + (random() * 2 - 1) * 2 * reach] : [coord(), coord()];
    const where = `seed ${seed} case ${i}: ${JSON.stringify(c)}, pointer ${raw}, pixel ${pixel}`;
    // Brute force: the nearest sample; samples are at most (length / N) apart, so the true nearest is within that of it.
    let best = Infinity;
    let at = -1;
    pts.forEach((p, k) => {
      const d = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
      if (d < best) [best, at] = [d, k];
    });
    const length = c.kind === "line" ? Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) : 2 * Math.PI * 31;
    const slack = length / N + 1e-9;
    // An arc whose nearest point is one of its ends (or right by one) is left to point snapping: skip the case.
    if (c.kind === "arc" && (at <= 1 || at >= N - 1)) continue;
    if (Math.abs(best - reach) <= slack) continue; // too close to the reach's edge for the samples to judge
    const snap = snapPointer(raw, raw, onlyCurves([c]), pixel);
    if (best < reach) {
      assert.equal(snap.kind, "on", where);
      const d = Math.hypot(snap.at[0] - raw[0], snap.at[1] - raw[1]);
      assert.ok(d <= best + 1e-9 && d >= best - slack, `${where}: landed ${d} away, brute force ${best}`);
      // Exactly on the edge: on the line between its ends, or the radius from the centre.
      if (c.kind === "line") {
        const cross = (c.b[0] - c.a[0]) * (snap.at[1] - c.a[1]) - (c.b[1] - c.a[1]) * (snap.at[0] - c.a[0]);
        assert.ok(Math.abs(cross) <= 1e-9 * (length + 1) * 100, `${where}: ${cross} off the line`);
      } else {
        const r = c.kind === "circle" ? c.radius : Math.hypot(c.start[0] - c.centre[0], c.start[1] - c.centre[1]);
        assert.ok(Math.abs(Math.hypot(snap.at[0] - c.centre[0], snap.at[1] - c.centre[1]) - r) <= 1e-9, `${where}: off the circle`);
      }
      landed++;
    } else {
      assert.equal(snap.kind, "grid", where);
      missed++;
    }
  }
  assert.ok(landed >= 1000 && missed >= 300, `${landed} landed, ${missed} missed`);
});
