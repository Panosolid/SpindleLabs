// @ts-nocheck
// Step 35ed3: cases killing the mutants of boolean-names.ts that the
// kernel cases and seeded sessions let through (Stryker target "combine",
// packages/testing/stryker/combine.json). Small bodies written by hand
// (only the view fields the code reads), each expected value worked out in
// the comment beside it; faceHolds against an independent distance model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { seeded } from "../../../packages/testing/src/index.ts";
import { bodyLow, combineNames, cornerCompare, sizeCompare, designNames, faceHolds, faceLow, featureBody, fullNames, resolveEdgeName, resolveFaceName, resolveOldEdge, roleOrder, SAME_CORNER, solidHolds } from "../src/boolean-names.ts";

/** A view with only what boolean-names.ts reads. */
function view(v = {}) {
  return { bounds: [[0, 0, 0], [1, 1, 1]], volume: 1, face_areas: [], edge_faces: [], edge_vertices: [], vertex_points: [], face_roles: [], mesh: { positions: [], indices: [], triangle_faces: [] }, ...v };
}

/** The display mesh of the box [lo, hi]: 8 corners, 2 triangles a face, faces −x, +x, −y, +y, −z, +z. */
function boxMesh(lo, hi) {
  const positions = [];
  for (let i = 0; i < 8; i++) positions.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
  const quads = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
  const indices = [];
  const triangle_faces = [];
  quads.forEach(([a, b, c, d], f) => {
    indices.push(a, b, c, a, c, d);
    triangle_faces.push(f, f);
  });
  return { positions, indices, triangle_faces };
}

const body = (id, handle, v, names, made = new Map()) => ({ id, handle, view: v, faces: names.map((n) => ({ names: n })), made });

test("roleOrder: no role is last of all; a side without loop or piece counts them 0", () => {
  // A face the operation gave no role comes after every role: [Infinity].
  assert.deepEqual(roleOrder(null), [Infinity]);
  // A side (2) with piece 3 and no boundary: [2, 0, 3].
  assert.deepEqual(roleOrder({ role: "side", piece: 3 }), [2, 0, 3]);
});

test("featureBody: a face without a name has none and no made order", () => {
  const b = featureBody("body:feature-2", 7, view({ face_roles: [{ role: "start" }, null] }), { feature: "feature-2", faces: ["start", null] }, 4);
  assert.deepEqual(b.faces, [{ names: ["face:feature-2/start"] }, { names: [] }]);
  // made: the feature's place 4, then start's order 0, loop 0, piece 0.
  assert.deepEqual([...b.made], [["face:feature-2/start", [4, 0, 0, 0]]]);
});

test("cornerCompare: exactly SAME_CORNER apart is apart; the sign follows the smaller x", () => {
  // 1e-5 apart on x is not within SAME_CORNER (strictly less is the same corner): a before b.
  assert.ok(cornerCompare([0, 0, 0], [SAME_CORNER, 0, 0]) < 0);
  // x 1 against −1: 2 apart (their sum, 0, would say the same corner).
  assert.ok(cornerCompare([1, 0, 0], [-1, 0, 0]) > 0);
  // x 1 against −3: the second is lower, so the first comes after (positive).
  assert.ok(cornerCompare([1, 0, 0], [-3, 0, 0]) > 0);
  assert.ok(cornerCompare([-3, 0, 0], [1, 0, 0]) < 0);
});

test("sizeCompare: a difference of exactly TIE × the larger is a tie", () => {
  // 5e-315 and 5e-315 − 5e-324 (one step of the smallest numbers): their
  // difference 5e-324 equals 1e-9 × 5e-315 rounded, so they tie (0).
  assert.equal(sizeCompare(5e-315 - 5e-324, 5e-315), 0);
});

test("bodyLow: the lowest corner, the first of tied ones; none gives infinity", () => {
  const pts = [[1, 0, 0], [0, 0, 0], [2, 0, 0], [0, 0, 0.5 * SAME_CORNER]];
  // x 0 is lowest; the corner 0.5e-5 above it ties (same corner), so the first, [0,0,0].
  assert.equal(bodyLow(view({ vertex_points: pts })), pts[1]);
  assert.deepEqual(bodyLow(view({ vertex_points: [] })), [Infinity, Infinity, Infinity]);
});

test("faceLow: only the corners of edges round the face, from either side of an edge", () => {
  // Face 0 has edges 0 (faces [0,1], corners (1,1,1) and (5,5,5)) and 3
  // (faces [2,0], corners (3,3,3) and (2,2,2)): its lowest is (1,1,1), on
  // an edge listing it first. Face 2 has edges 1 ([1,2], (0,0,0) and
  // (3,3,3)) and 3: lowest (0,0,0), on an edge listing it second. Edge 2 is
  // a seam with no faces (null), edge 4 lists face 0 but has no corners.
  const v = view({
    vertex_points: [[5, 5, 5], [1, 1, 1], [0, 0, 0], [3, 3, 3], [2, 2, 2]],
    edge_faces: [[0, 1], [1, 2], null, [2, 0], [0, 2]],
    edge_vertices: [[1, 0], [2, 3], [2, 2], [3, 4]],
  });
  assert.deepEqual(faceLow(v, 0), [1, 1, 1]);
  assert.deepEqual(faceLow(v, 2), [0, 0, 0]);
});

test("combineNames: nothing left fails in words; mismatched answers and strange bodies are refused", () => {
  const t = body("body:feature-1", 1, view(), [["face:feature-1/start"]]);
  assert.deepEqual(combineNames("feature-3", "difference", t, [], { bodies: [], history: [] }, []), { failed: "it would leave nothing of body:feature-1" });
  assert.throws(() => combineNames("feature-3", "difference", t, [], { bodies: [5], history: [{ faces: [] }] }, []), /each result body needs its view and its history/);
  assert.throws(() => combineNames("feature-3", "difference", t, [], { bodies: [5], history: [] }, [view()]), /each result body needs its view and its history/);
  assert.throws(() => combineNames("feature-3", "difference", t, [], { bodies: [5], history: [{ faces: [{ body: 9, face: 0 }] }] }, [view()]), /not an input \(9\)/);
  // A face index past the input's faces gives a face with no names.
  const r = combineNames("feature-3", "difference", t, [], { bodies: [5], history: [{ faces: [{ body: 1, face: 4 }] }] }, [view({ face_areas: [1] })]);
  assert.deepEqual(r.bodies[0].faces, [{ names: [] }]);
});

test("combineNames by hand: first reached, then share summed over split pieces, then volume; unnamed faces walk last", () => {
  // Target faces: a (made [0,0]), b ([0,1]), u (a name with no made order)
  // and n (no name): a and b walk first; u and n after (Infinity).
  // Pieces: p0 gets b only; p1 a piece of a (area 1) and u and n; p2 two
  // pieces of a (1 + 1 = 2). Walk: a reaches p1 and p2 (two, no keeper),
  // b reaches p0 alone, so p0 keeps the target's id. Order: p1 and p2 are
  // both first reached at step 0; p2's share 2 beats p1's 1, though p1's
  // volume 50 beats p2's 20. So piece 1 is p2, piece 2 is p1, next 3.
  const made = new Map([["face:t/a", [0, 0]], ["face:t/b", [0, 1]]]);
  const t = body("body:t", 1, view(), [["face:t/a"], ["face:t/b"], ["face:t/u"], []], made);
  const history = [
    { faces: [{ body: 1, face: 1 }] },
    { faces: [{ body: 1, face: 0 }, { body: 1, face: 2 }, { body: 1, face: 3 }] },
    { faces: [{ body: 1, face: 0 }, { body: 1, face: 0 }] },
  ];
  const views = [view({ volume: 10, face_areas: [5] }), view({ volume: 50, face_areas: [1, 0.5, 0.5] }), view({ volume: 20, face_areas: [1, 1] })];
  const r = combineNames("feature-9", "difference", t, [], { bodies: [100, 101, 102], history }, views);
  assert.deepEqual(r.bodies.map((b) => [b.id, b.handle]), [["body:t", 100], ["body:feature-9/piece:1", 102], ["body:feature-9/piece:2", 101]]);
  assert.equal(r.nextPiece, 3);
});

test("combineNames: pieces tied on everything keep the kernel's order, the first keeping the id", () => {
  // Two pieces reached by no face of the target, same volume, same lowest
  // corner: the kernel's order decides, so piece 0 keeps body:t, piece 1
  // is piece 4 (counting from 4), next 5.
  const t = body("body:t", 1, view(), [["face:t/a"]]);
  const same = () => view({ volume: 8, vertex_points: [[0, 0, 0]] });
  const r = combineNames("feature-9", "difference", t, [], { bodies: [100, 101, 102, 103], history: [{ faces: [] }, { faces: [] }, { faces: [] }, { faces: [] }] }, [same(), same(), same(), same()], 4);
  assert.deepEqual(r.bodies.map((b) => [b.id, b.handle]), [["body:t", 100], ["body:feature-9/piece:4", 101], ["body:feature-9/piece:5", 102], ["body:feature-9/piece:6", 103]]);
  assert.equal(r.nextPiece, 7);
});

test("solidHolds: odd crossings inside a box, even outside", () => {
  const v = view({ mesh: boxMesh([0, 0, 0], [2, 3, 4]) });
  // Inside the box [0,2]×[0,3]×[0,4]: (1, 1.5, 2) and a point 1e-6 from a wall.
  assert.equal(solidHolds(v, [1, 1.5, 2]), true);
  assert.equal(solidHolds(v, [1e-6, 1, 1]), true);
  // Outside: beyond each wall, and behind the box along the ray (its parts are all positive, so a point below crosses it twice).
  for (const p of [[-1, 1, 1], [3, 1, 1], [1, -1, 1], [1, 4, 1], [1, 1, -1], [1, 1, 5], [-5, -5, -5]]) assert.equal(solidHolds(v, p), false, String(p));
  // A box high up, z 100–104: (1, 1.5, 102) inside, (1, 1.5, 2) below it.
  const high = view({ mesh: boxMesh([0, 0, 100], [2, 3, 104]) });
  assert.equal(solidHolds(high, [1, 1.5, 102]), true);
  assert.equal(solidHolds(high, [1, 1.5, 2]), false);
});

test("a swallowed target with no corner listed goes to the smallest box round it", () => {
  // No face of the target is left and it has no corners to test: the
  // smallest box holding its box ([0,1]³) is piece 1's (8 against 27).
  const t = body("body:t", 1, view({ bounds: [[0, 0, 0], [1, 1, 1]] }), [["face:t/a"]]);
  const big = view({ bounds: [[-1, -1, -1], [2, 2, 2]], volume: 27, mesh: boxMesh([-1, -1, -1], [2, 2, 2]) });
  const small = view({ bounds: [[-0.5, -0.5, -0.5], [1.5, 1.5, 1.5]], volume: 8 });
  const r = combineNames("feature-9", "union", t, [], { bodies: [100, 101], history: [{ faces: [] }, { faces: [] }] }, [big, small]);
  assert.equal(r.bodies[0].handle, 101);
});

test("a union's piece with a face of the target keeps its id, whatever boxes hold the target", () => {
  // The target's face 0 reaches piece 1 (its only face), piece 0 has a
  // tool's face only; piece 0's box holds the target's box and piece 1's
  // does not, so the face decides: piece 1 keeps body:t. Then the face in
  // piece 0 (index 0, so 0 is a found index too), the box in piece 1.
  const t = body("body:t", 1, view({ bounds: [[0, 0, 0], [1, 1, 1]] }), [["face:t/a"]]);
  const tool = body("body:u", 2, view(), [["face:u/a"]]);
  const holding = view({ bounds: [[-1, -1, -1], [2, 2, 2]], face_areas: [1] });
  const apart = view({ bounds: [[5, 5, 5], [6, 6, 6]], face_areas: [1] });
  const r1 = combineNames("feature-9", "union", t, [tool], { bodies: [100, 101], history: [{ faces: [{ body: 2, face: 0 }] }, { faces: [{ body: 1, face: 0 }] }] }, [holding, apart]);
  assert.equal(r1.bodies[0].handle, 101);
  const r2 = combineNames("feature-9", "union", t, [tool], { bodies: [100, 101], history: [{ faces: [{ body: 1, face: 0 }] }, { faces: [{ body: 2, face: 0 }] }] }, [apart, holding]);
  assert.equal(r2.bodies[0].handle, 100);
});

test("a swallowed target: only boxes holding its box on every axis, within SAME_CORNER, are tried", () => {
  // No corner of the target is inside any piece's mesh (none given), so
  // the smallest holding box decides. Target box [0,1]³. Pieces 0 and 1
  // (2 mm³ each) hold it on x and y but not z: piece 0 reaches below
  // (z −0.5 to 0.5, top short of 1), piece 1 above (z 5 to 5.5, bottom
  // above 0). Piece 2 (about 9 mm³) holds it, its x side exactly SAME_CORNER
  // inside the target's on each end (1e-5 and 1 − 1e-5): counts as holding.
  const t = body("body:t", 1, view({ bounds: [[0, 0, 0], [1, 1, 1]], vertex_points: [[0, 0, 0]] }), [["face:t/a"]]);
  const views = [
    view({ bounds: [[-0.5, -0.5, -0.5], [1.5, 1.5, 0.5]] }),
    view({ bounds: [[-0.5, -0.5, 5], [1.5, 1.5, 5.5]] }),
    view({ bounds: [[SAME_CORNER, -1, -1], [1 - SAME_CORNER, 2, 2]] }),
  ];
  const r = combineNames("feature-9", "union", t, [], { bodies: [100, 101, 102], history: [{ faces: [] }, { faces: [] }, { faces: [] }] }, views);
  assert.equal(r.bodies[0].handle, 102);
});

test("fullNames and designNames: seams, faces past the list, unnamed faces and stray corners are skipped", () => {
  // Faces 0 and 1 both carry "face:a" (a split face); 2 is "face:b", 3 has
  // no name. Edges: 0 = faces 0,2 (corners 0,1); 1 = faces 1,3 (corners
  // 2,3); 2 = a seam (null); 3 = faces 0 and 9 (no face 9); 4 = faces 9,1;
  // 5 = faces 1,2 (corners 2 and 99, no corner 99); 6 = faces 3,2.
  // Face 0 borders b only and face 1 borders b and the unnamed face, so
  // their tags: face 1 has nothing face 0 lacks except the unnamed face,
  // which counts for nothing, so its tag is empty; face 0's neighbours are
  // all face 1's too: empty as well.
  const v = view({
    vertex_points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]],
    edge_faces: [[0, 2], [1, 3], null, [0, 9], [9, 1], [1, 2], [3, 2]],
    edge_vertices: [[0, 1], [2, 3], [0, 0], [0, 1], [2, 3], [2, 99], [1, 3]],
  });
  const b = body("body:x", 1, v, [["face:a"], ["face:a"], ["face:b"], []]);
  assert.deepEqual(fullNames([b]), [["face:a#", "face:a#", "face:b", null]]);
  const names = designNames([b]);
  // Edge 0: face:a# and face:b; edge 5 the same two, so both take ;ends:
  // the other named faces at their corners. Edge 0's corners 0 and 1 meet
  // edges 0, 2, 3 and 6 (faces 0, 2, 9, 3): named others none (face 9 is
  // past the list, face 3 unnamed). Edge 5's corner 2 meets edges 1, 4 and
  // 5 (faces 1, 3, 9, 2): none; corner 99 none. Tied: both null.
  assert.deepEqual(names.edges[0][0], { faces: ["face:a#", "face:b"], ends: [], name: null });
  assert.equal(names.edges[0][5].name, null);
  // Edges with an unnamed face, a seam, or a face past the list: null.
  for (const e of [1, 2, 3, 4, 6]) assert.equal(names.edges[0][e], null, `edge ${e}`);
  assert.deepEqual(resolveEdgeName(names, "edge:face:a#+face:b"), { ambiguous: 2 });
  assert.deepEqual(resolveEdgeName(names, "edge:face:z+face:b"), { lost: true });
});

test("fullNames: an unnamed neighbour never enters a tag", () => {
  // Faces 0 and 1 carry "face:a"; face 0 borders "face:b" and an unnamed
  // face 3, face 1 borders "face:c". Tags: face 0 "face:b", face 1 "face:c".
  const v = view({ edge_faces: [[0, 2], [0, 3], [1, 4], [3, 0]], edge_vertices: [] });
  const b = body("body:x", 1, v, [["face:a"], ["face:a"], ["face:b"], [], ["face:c"]]);
  assert.deepEqual(fullNames([b])[0].slice(0, 2), ["face:a#face:b", "face:a#face:c"]);
});

test("designNames: an end face with no name is not an end", () => {
  // A square face 0 "face:top" with sides 1, 2 (named) and 3 (unnamed).
  // Edge 0 = faces 0,1 from corner 0 to 1; edge 1 = faces 0,2 from 1 to 2;
  // edge 2 = faces 0,3 from 2 to 0... edge 0's ends meet edges 1 and 2:
  // faces 2 and 3 beside it; 3 has no name, so ends ["face:s2"].
  const v = view({ vertex_points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], edge_faces: [[0, 1], [0, 2], [0, 3]], edge_vertices: [[0, 1], [1, 2], [2, 0]] });
  const b = body("body:x", 1, v, [["face:top"], ["face:s1"], ["face:s2"], []]);
  assert.deepEqual(designNames([b]).edges[0][0].ends, ["face:s2"]);
});

test("resolveFaceName and resolveOldEdge: nothing carrying the name is lost; seams and stray faces skipped", () => {
  const v = view({ edge_faces: [null, [0, 1], [0, 7], [7, 0]] });
  const b = body("body:x", 1, v, [["face:a"], ["face:b"]]);
  assert.deepEqual(resolveFaceName([b], designNames([b]), { name: "face:zz" }), { lost: true });
  assert.deepEqual(resolveOldEdge([b], "face:a", "face:zz"), { lost: true });
  assert.deepEqual(resolveOldEdge([b], "face:b", "face:a"), { body: 0, index: 1, warning: null });
});

/** The distance from p to the triangle abc, worked out apart from faceHolds: the foot on the plane when it lies inside (by barycentric weights from 2×2 normal equations), else the nearest of the three sides (clamped). */
function triangleDistance(p, a, b, c) {
  const sub = (x, y) => x.map((v, i) => v - y[i]);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  const u = sub(b, a);
  const w = sub(c, a);
  const r = sub(p, a);
  const [uu, uw, ww, ru, rw] = [dot(u, u), dot(u, w), dot(w, w), dot(r, u), dot(r, w)];
  const det = uu * ww - uw * uw;
  const s = (ru * ww - rw * uw) / det;
  const t = (rw * uu - ru * uw) / det;
  if (s >= 0 && t >= 0 && s + t <= 1) return Math.hypot(...sub(r, u.map((v, i) => s * v + t * w[i])));
  const seg = (x, y) => {
    const d = sub(y, x);
    const k = Math.min(1, Math.max(0, dot(sub(p, x), d) / dot(d, d)));
    return Math.hypot(...sub(p, x.map((v, i) => v + k * d[i])));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

test("faceHolds by hand: on the face, by an edge or corner within SAME_CORNER, not beyond", () => {
  // The face is the triangle (0,0,0), (1,0,0), (0,1,0) (face 0), with a
  // triangle of face 1 far away. (0.2, 0.2, 0.5e-5) is above the inside,
  // 0.5e-5 off; (0.5, −0.9e-5, 0) is 0.9e-5 beyond the edge y = 0;
  // (−0.6e-5, −0.6e-5, 0) is 0.6e-5·√2 ≈ 0.85e-5 from the corner; and
  // (0.5, 0.5, 0) plus 1.1e-5/√2 along (1,1,0) is 1.1e-5 beyond the long edge.
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9, 10, 9, 9, 9, 10, 9], indices: [3, 4, 5, 0, 1, 2], triangle_faces: [1, 0] };
  const v = view({ mesh });
  assert.equal(faceHolds(v, 0, [0.2, 0.2, 0.5e-5]), true);
  assert.equal(faceHolds(v, 0, [0.5, -0.9e-5, 0]), true);
  assert.equal(faceHolds(v, 0, [0.5, -1.1e-5, 0]), false);
  assert.equal(faceHolds(v, 0, [-0.6e-5, -0.6e-5, 0]), true);
  // Exactly SAME_CORNER beyond the corner (0,0,0) along −x: held (within, edge counting in).
  assert.equal(faceHolds(v, 0, [-SAME_CORNER, 0, 0]), true);
  const out = 1.1e-5 / Math.SQRT2;
  assert.equal(faceHolds(v, 0, [0.5 + out, 0.5 + out, 0]), false);
  assert.equal(faceHolds(v, 1, [0.2, 0.2, 0]), false);
});

test("faceHolds agrees with an independent distance on seeded points by every part of a triangle", () => {
  // Seeded triangles; points near a corner, a side or the inside, pushed
  // off by 0.9 or 1.1 × SAME_CORNER (or anything up to 3×) in a random
  // direction: held exactly when the independent distance is within SAME_CORNER.
  const r = seeded(35_303n);
  const rand = () => r.next();
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const tri = [0, 1, 2].map(() => [0, 1, 2].map(() => rand() * 4 - 2));
    const mesh = { positions: tri.flat(), indices: [0, 1, 2], triangle_faces: [0] };
    const [l1, l2] = [rand(), rand()];
    const w = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [l1 * (1 - l2), l2 * (1 - l1), 0]][n % 7];
    const w3 = n % 7 === 6 ? [w[0], w[1], 1 - w[0] - w[1]] : w;
    const base = [0, 1, 2].map((i) => w3[0] * tri[0][i] + w3[1] * tri[1][i] + w3[2] * tri[2][i]);
    const dir = [0, 1, 2].map(() => rand() * 2 - 1);
    const len = Math.hypot(...dir);
    const off = [0.9, 1.1, 3 * rand()][n % 3] * SAME_CORNER;
    const p = base.map((x, i) => x + (dir[i] / len) * off);
    const d = triangleDistance(p, ...tri);
    if (Math.abs(d - SAME_CORNER) < 1e-9) continue; // too near the line to call either way
    assert.equal(faceHolds(view({ mesh }), 0, p), d <= SAME_CORNER, `n ${n}: distance ${d}`);
    checked++;
  }
  assert.ok(checked > 390);
});
