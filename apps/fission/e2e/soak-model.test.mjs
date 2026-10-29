// The soak test's model (soak-model.mjs), worked by hand: the STL reader on
// boxes written here, the model's sums, and each comparison failing in the
// way it should, with the tolerances at 0.9× (passes) and 1.1× (fails).
import test from "node:test";
import assert from "node:assert/strict";
import { BOUNDS_TOL, expected, matchesModel, sameState, stlFacts, VOLUME_TOL } from "./soak-model.mjs";

/** A binary STL of the boxes [[x0, y0, z0], [x1, y1, z1]], each face two triangles wound outward. */
function stl(boxes) {
  const tris = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of boxes) {
    const p = (i, j, k) => [[x0, x1][i], [y0, y1][j], [z0, z1][k]];
    // Each face's corners counter-clockwise seen from outside.
    const faces = [
      [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)], // bottom, seen from below
      [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], // top
      [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], // front, y = y0
      [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)], // back, y = y1
      [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)], // left, x = x0
      [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], // right, x = x1
    ];
    for (const [a, b, c, d] of faces) tris.push([a, b, c], [a, c, d]);
  }
  const out = Buffer.alloc(84 + 50 * tris.length);
  out.writeUInt32LE(tris.length, 80);
  tris.forEach((t, n) => t.forEach((v, k) => v.forEach((x, i) => out.writeFloatLE(x, 84 + 50 * n + 12 + 12 * k + 4 * i))));
  return out;
}

test("the STL reader: a 2 × 3 × 4 box has 12 triangles, volume 24 and its own bounds, wherever it is", () => {
  // V = 2 · 3 · 4 = 24 mm³; 6 faces of 2 triangles.
  assert.deepEqual(stlFacts(stl([[[0, 0, 0], [2, 3, 4]]])), { triangles: 12, volume: 24, bounds: [[0, 2], [0, 3], [0, 4]] });
  // Moved to (100, −50, 7): the same 24 (the divergence theorem's sum does not depend on where the origin is), bounds moved with it.
  const far = stlFacts(stl([[[100, -50, 7], [102, -47, 11]]]));
  assert.equal(far.triangles, 12);
  assert.ok(Math.abs(far.volume - 24) < 24 * VOLUME_TOL, `volume ${far.volume}`);
  assert.deepEqual(far.bounds, [[100, 102], [-50, -47], [7, 11]]);
  // A face wound inward would subtract: the reader does not take absolute values.
  const two = stlFacts(stl([[[0, 0, 0], [2, 3, 4]], [[10, 0, 0], [11, 1, 1]]]));
  assert.equal(two.volume, 25); // 24 + 1 · 1 · 1
});

test("the model: an extruded 10 × 20 × 15 and a 46 × 30 × 20 box lifted 2", () => {
  // 10 · 20 · 15 = 3,000 and 46 · 30 · 20 = 27,600: 30,600 mm³; bottoms at 0 and 2, tops at 15 and 22.
  assert.deepEqual(expected([{ w: 10, d: 20, h: 15, z: 0 }, { w: 46, d: 30, h: 20, z: 2 }]), { bodies: 2, triangles: 24, volume: 30_600, z: [0, 22] });
});

/** A reading of the app as the model would have it: those two bodies, laid side by side. */
function reading() {
  const facts = stlFacts(stl([[[0, 0, 0], [10, 20, 15]], [[20, 0, 2], [66, 30, 22]]]));
  return { stl: facts, items: ["1. Sketch 1", "2. Extrude 1", "3. Box 1", "4. Move 1"], bodies: 2, kernel: 3 };
}
const want = expected([{ w: 10, d: 20, h: 15, z: 0 }, { w: 46, d: 30, h: 20, z: 2 }]);

test("matchesModel: a matching reading has no problems, and each kind of mismatch is named", () => {
  assert.deepEqual(matchesModel(reading(), want, 4), []);
  const r = reading();
  assert.deepEqual(matchesModel({ ...r, stl: { ...r.stl, triangles: 22 } }, want, 4), ["the STL has 22 triangles, the model 24"]);
  assert.deepEqual(matchesModel({ ...r, bodies: 1 }, want, 4), ["the Browser lists 1 bodies, the model 2"]);
  assert.deepEqual(matchesModel(r, want, 3), ["the timeline has 4 items, the model 3"]);
  // The rectangle drawn 10 × 15 instead of 10 × 20 (the mistake this model first caught in the test itself): 750 mm³ short.
  assert.match(matchesModel({ ...r, stl: { ...r.stl, volume: 29_850 } }, want, 4)[0], /volume is 29,850 mm³, the model's 30,600/);
  assert.match(matchesModel({ ...r, stl: { ...r.stl, bounds: [[0, 66], [0, 30], [0, 20]] } }, want, 4)[0], /spans z 0\.\.20, the model 0\.\.22/);
});

test("matchesModel's tolerances: volume within 0.9 × VOLUME_TOL passes and 1.1 × fails; the height range likewise with BOUNDS_TOL", () => {
  const r = reading();
  const at = (f) => ({ ...r, stl: { ...r.stl, volume: want.volume * (1 + f * VOLUME_TOL) } });
  assert.deepEqual(matchesModel(at(0.9), want, 4), []);
  assert.deepEqual(matchesModel(at(-0.9), want, 4), []);
  assert.equal(matchesModel(at(1.1), want, 4).length, 1);
  assert.equal(matchesModel(at(-1.1), want, 4).length, 1);
  const top = (f) => ({ ...r, stl: { ...r.stl, bounds: [r.stl.bounds[0], r.stl.bounds[1], [0, 22 + f * BOUNDS_TOL]] } });
  assert.deepEqual(matchesModel(top(0.9), want, 4), []);
  assert.equal(matchesModel(top(1.1), want, 4).length, 1);
  assert.equal(matchesModel(top(-1.1), want, 4).length, 1);
});

test("sameState: the same reading agrees; each difference is named; bounds at 0.9 × and 1.1 × BOUNDS_TOL", () => {
  const a = reading();
  assert.deepEqual(sameState(a, reading(), "reopened"), []);
  assert.deepEqual(sameState(a, { ...a, items: a.items.slice(0, 3) }, "reopened").length, 1);
  assert.match(sameState(a, { ...a, kernel: 2 }, "reopened")[0], /^reopened: the kernel holds 2 shapes, was 3$/);
  assert.match(sameState(a, { ...a, bodies: 1 }, "reopened")[0], /^reopened: the Browser lists 1 bodies, was 2$/);
  assert.match(sameState(a, { ...a, stl: { ...a.stl, triangles: 12 } }, "reopened")[0], /12 triangles, was 24/);
  assert.match(sameState(a, { ...a, stl: { ...a.stl, volume: a.stl.volume * (1 + 1.1 * VOLUME_TOL) } }, "reopened")[0], /volume/);
  assert.deepEqual(sameState(a, { ...a, stl: { ...a.stl, volume: a.stl.volume * (1 + 0.9 * VOLUME_TOL) } }, "reopened"), []);
  // The box slid 1 mm along x by a reader that lost part of a Move: only the bounds can tell.
  const slid = (dx) => ({ ...a, stl: { ...a.stl, bounds: [[0, 66 + dx], a.stl.bounds[1], a.stl.bounds[2]] } });
  assert.match(sameState(a, slid(1), "reopened")[0], /bounds/);
  assert.deepEqual(sameState(a, slid(0.9 * BOUNDS_TOL), "reopened"), []);
  assert.equal(sameState(a, slid(1.1 * BOUNDS_TOL), "reopened").length, 1);
});
