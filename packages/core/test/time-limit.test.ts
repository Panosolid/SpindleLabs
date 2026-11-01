// Unit tests for the kernel calls' time limits (step 35d3, time-limit.ts).
// Run with `npm test` (Node's built-in test runner).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BodySpec } from "../src/kernel/kernel-types.ts";
import { booleanUnits, calibrate, CALIBRATION_TARGET, CALIBRATION_TOOL, sliceUnits, buildFaces, buildUnits, callUnits, facesSize, HEADROOM, LIMIT_FLOOR_MS, limitMs, MOST_PAIRS, sketchUnits, UNITS_PER_CORNER, UNITS_PER_PAIR } from "../src/kernel/time-limit.ts";

/** An L in plan, 6 corners, with a round hole: 2 caps + 6 sides + 1 round side = 9 faces. */
const lWithHole = {
  extrude: {
    profile: { outer: { path: { corners: [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20], bulges: [] } }, holes: [{ circle: { center: [5, 5], radius: 2 } }] },
    distance: 3,
  },
} satisfies BodySpec;

test("a build's faces and units by hand", () => {
  // The L: 6 corners, the circle one more: 7 corners, 7 × 11 = 77 units; faces 2 caps + 7 sides = 9.
  assert.equal(buildFaces(lWithHole), 9);
  assert.equal(buildUnits(lWithHole), 77);
  // Moved, the same body: the moves don't count.
  assert.equal(buildUnits({ moved: { body: lWithHole, moves: [{ move: [1, 2, 3] }] } }), 77);
  // A box: 6 faces, its 4 profile corners × 11 = 44; a cylinder 3 faces, 11; a sphere 2 faces, 60 (its mesh).
  assert.equal(buildFaces({ box: { width: 1, depth: 1, height: 1 } }), 6);
  assert.equal(buildUnits({ box: { width: 1, depth: 1, height: 1 } }), 44);
  assert.equal(buildFaces({ cylinder: { radius: 1, height: 1 } }), 3);
  assert.equal(buildUnits({ cylinder: { radius: 1, height: 1 } }), 11);
  assert.equal(buildFaces({ sphere: { radius: 1 } }), 2);
  assert.equal(buildUnits({ sphere: { radius: 1 } }), 60);
});

test("a boolean's units by hand: each tool meets every piece so far, each step capped at the costliest legal boolean", () => {
  const cube = facesSize(6);
  // One tool: 6 × 6 = 36 pairs, × 0.17 = 6.12 units.
  assert.ok(Math.abs(booleanUnits(cube, [cube]) - 6.12) < 1e-9);
  // Two tools: 36, then the second meets the target's 6 faces and the first tool's 6: 12 × 6 = 72; 108 × 0.17 = 18.36.
  assert.ok(Math.abs(booleanUnits(cube, [cube, cube]) - 18.36) < 1e-9);
  // Two 1,000-face bodies: 1,000,000 pairs, capped at 450² = 202,500, × 0.17 = 34,425.
  assert.ok(Math.abs(booleanUnits(facesSize(1000), [facesSize(1000)]) - 34_425) < 1e-6);
  assert.equal(MOST_PAIRS * UNITS_PER_PAIR, 34_425);
  // No tools, no work.
  assert.equal(booleanUnits(cube, []), 0);
});

test("a sketch's units by hand: 0.25 a curve and 0.00012 a pair", () => {
  // 100 curves: 25 + 0.00012 × 10,000 = 26.2; 2,000: 500 + 480 = 980.
  assert.ok(Math.abs(sketchUnits(100) - 26.2) < 1e-9);
  assert.ok(Math.abs(sketchUnits(2000) - 980) < 1e-9);
  assert.equal(callUnits("sketch_outline", [Array(1000).fill(null), Array(600).fill(null), Array(400).fill(null)] as never, () => undefined), sketchUnits(2000));
});

test("the limit is the floor, or units × the calibration × HEADROOM above it", () => {
  assert.equal(HEADROOM, 4);
  assert.equal(limitMs(0, 1), LIMIT_FLOOR_MS);
  // 1,000 units at 2 ms a unit: 8,000 ms, under the floor.
  assert.equal(limitMs(1000, 2), LIMIT_FLOOR_MS);
  // 2,000 at 2 ms: 16,000 ms.
  assert.equal(limitMs(2000, 2), 16_000);
  // The browser checks' own floor.
  assert.equal(limitMs(0, 1, 3000), 3000);
});

test("each call's units: the quick ones none, a body's view its mesh, a build its corners", () => {
  const sizes = new Map([[7, { faces: 9, mesh: 77 }]]);
  const sizeOf = (h: number) => sizes.get(h);
  for (const op of ["kernel_version", "snap_to_grid", "place_freely", "body_free", "body_count", "wasm_bytes"] as const) assert.equal(callUnits(op, [] as never, sizeOf), 0, op);
  assert.equal(callUnits("body_view", [7], sizeOf), 77);
  assert.equal(callUnits("body_stl", [7, "x"], sizeOf), 77);
  assert.equal(callUnits("body_step", [7], sizeOf), 77);
  assert.equal(callUnits("body_view", [8], sizeOf), 0, "an unknown handle is refused at once: the floor");
  assert.equal(callUnits("body_build", [lWithHole], sizeOf), 77);
  assert.equal(callUnits("export_stl", [lWithHole, "x"], sizeOf), 77);
  assert.equal(callUnits("make_extrude", [lWithHole.extrude.profile, 3], sizeOf), 7 * UNITS_PER_CORNER);
  assert.equal(callUnits("make_sphere", [5], sizeOf), 60);
});

/** A binary STL of triangles given by their corners' z (x and y anything), with `claimed` triangles in its count. */
function stl(zs: number[][], claimed = zs.length): Uint8Array {
  const out = new Uint8Array(84 + 50 * zs.length);
  const data = new DataView(out.buffer);
  data.setUint32(80, claimed, true);
  zs.forEach((tri, t) => tri.forEach((z, c) => data.setFloat32(84 + 50 * t + 12 + 12 * c + 8, z, true)));
  return out;
}

test("a slice's units by hand: its triangles times its layers, over every file given back to back", () => {
  // 2 triangles from z 0 to 10 at 0.2 mm: 50 layers, 2 × 50 × 0.12 = 12 units.
  const a = stl([
    [0, 0, 10],
    [10, 10, 0],
  ]);
  assert.ok(Math.abs(sliceUnits(a, 0.2) - 12) < 1e-9);
  // Another file after it, 1 triangle from z 5 to 20: 3 triangles, z 0 to 20, 100 layers: 36 units.
  const b = stl([[5, 20, 5]]);
  const both = new Uint8Array([...a, ...b]);
  assert.ok(Math.abs(sliceUnits(both, 0.2) - 36) < 1e-9);
  // A second file claiming more triangles than it holds: the kernel refuses it at once, only the first counts.
  const short = new Uint8Array([...a, ...stl([[5, 20, 5]], 2)]);
  assert.ok(Math.abs(sliceUnits(short, 0.2) - 12) < 1e-9);
  // Nothing readable, a flat file, or no layer height: no units, the floor.
  assert.equal(sliceUnits(new Uint8Array(10), 0.2), 0);
  assert.equal(sliceUnits(stl([[1, 1, 1]]), 0.2), 0);
  assert.equal(sliceUnits(a, 0), 0);
  // Read from a view into a bigger buffer, as the worker gets it.
  const offset = new Uint8Array(4 + a.length);
  offset.set(a, 4);
  assert.ok(Math.abs(sliceUnits(offset.subarray(4), 0.2) - 12) < 1e-9);
  assert.equal(callUnits("slice_stl", [a as Uint8Array<ArrayBuffer>, 0.2, 3, 15, "off"], () => undefined), sliceUnits(a, 0.2));
});

/** Fake kernel calls for the calibration: each boolean takes `ms` on a fake clock; it counts what is kept. */
function fakeCalls(ms: number, failAt = Infinity) {
  let clock = 0;
  let next = 1;
  const kept = new Set<number>();
  const specs: unknown[] = [];
  let booleans = 0;
  return {
    kept,
    specs,
    booleans: () => booleans,
    calls: {
      build: (spec: BodySpec) => (specs.push(spec), kept.add(next), next++),
      boolean: (target: number, tools: number[], op: string) => {
        assert.deepEqual([target, tools, op], [1, [2], "union"]);
        if (++booleans >= failAt) throw new Error("planted");
        clock += ms;
        kept.add(next);
        return { bodies: [next++], history: [] };
      },
      free: (body: number) => void assert.ok(kept.delete(body), `body ${body} freed once`),
      now: () => clock,
    },
  };
}

test("the calibration times the cubes' boolean for 50 ms and 3 runs at least, and keeps nothing", () => {
  // 7 ms a run: 7 runs make 49 ms, the 8th 56 ms ≥ 50: 56 / 8 = 7 ms a unit.
  const quick = fakeCalls(7);
  assert.equal(calibrate(quick.calls), 7);
  assert.equal(quick.booleans(), 8);
  assert.deepEqual([...quick.kept], []);
  assert.deepEqual(quick.specs, [CALIBRATION_TARGET, CALIBRATION_TOOL]);
  // 100 ms a run (a slow phone): still 3 runs, 300 / 3 = 100.
  const slow = fakeCalls(100);
  assert.equal(calibrate(slow.calls), 100);
  assert.equal(slow.booleans(), 3);
  // A clock that never moves: 1,000 runs, then 0 (the client takes its default for 0).
  const stopped = fakeCalls(0);
  assert.equal(calibrate(stopped.calls), 0);
  assert.equal(stopped.booleans(), 1000);
  // A boolean that throws: the cubes are still freed, and the error goes on.
  const failing = fakeCalls(7, 2);
  assert.throws(() => calibrate(failing.calls), /planted/);
  assert.deepEqual([...failing.kept], [], "the first run's result and both cubes freed");
});

test("callUnits gives 0 (the floor) for arguments of the wrong shape, so the kernel can answer bad-request instead of a TypeError", () => {
  const none = () => undefined;
  // Cold read 2026-10-31: each of these threw a TypeError before.
  assert.equal(callUnits("make_extrude", ["nonsense", 1] as never, none), 0);
  assert.equal(callUnits("make_extrude", [{ outer: [] }, 1] as never, none), 0, "a profile with no holes list");
  assert.equal(callUnits("body_build", [null] as never, none), 0);
  assert.equal(callUnits("sketch_outline", [undefined, [], []] as never, none), 0);
  assert.equal(callUnits("body_boolean", [1, "x", "union"] as never, none), 0);
  assert.equal(callUnits("slice_stl", [null, "a"] as never, none), 0);
  // A well-shaped call is unchanged.
  assert.equal(callUnits("sketch_outline", [[1], [2], [3]] as never, none), sketchUnits(3));
});

/** A binary STL of a w × d × h box from the origin: 12 triangles (2 a face), normals left zero. */
function boxStl(w: number, d: number, h: number): Uint8Array {
  const v = (x: number, y: number, z: number) => [x * w, y * d, z * h];
  const quads = [
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const tris = quads.flatMap(([a, b, c, e]) => [[a, b, c], [a, c, e]]);
  const out = new Uint8Array(84 + 50 * tris.length);
  const data = new DataView(out.buffer);
  data.setUint32(80, tris.length, true);
  tris.forEach((tri, t) => tri.forEach((p, c) => p.forEach((x, k) => data.setFloat32(84 + 50 * t + 12 + 12 * c + 4 * k, x, true))));
  return out;
}

test("a big flat-sided part costs by its area too: a box is 12 triangles however big (slicer hunt M8), worked by hand", () => {
  // 100 × 100 × 10 mm at 0.2 mm: 50 layers. Triangles: 12 × 50 × 0.12 = 72. Area: 1e4 mm² × 50 layers × 6e-4 = 300, times the fill share.
  const box = boxStl(100, 100, 10);
  assert.ok(Math.abs(sliceUnits(box, 0.2, 100) - 300 * 1.25) < 1e-6, "100 %: share 0.25 + 1 = 1.25 → 375");
  assert.ok(Math.abs(sliceUnits(box, 0.2, 15) - 300 * 0.4) < 1e-6, "15 %: share 0.4 → 120, over the triangles' 72");
  assert.ok(Math.abs(sliceUnits(box, 0.2, 0) - 300 * 0.25) < 1e-6, "no infill: share 0.25 → 75, just over the triangles' 72");
  // A small part keeps its triangle count: a 20 mm cube at 0.2 mm, 100 layers: 12 × 100 × 0.12 = 144 over 20² × 100 × 6e-4 × 0.4 = 9.6.
  assert.ok(Math.abs(sliceUnits(boxStl(20, 20, 20), 0.2, 15) - 144) < 1e-9);
  // The default, when none is given, is the P1S's 15 %.
  assert.equal(sliceUnits(box, 0.2), sliceUnits(box, 0.2, 15));
  // The hunt's box, 246 × 246 × 245 mm at 100 %, was 1,764 units of triangles and needed at least 8.7 times that.
  const big = boxStl(246, 246, 245);
  assert.ok(sliceUnits(big, 0.2, 100) >= 8.7 * 1764, `${sliceUnits(big, 0.2, 100)} units`);
  // Fewer layers, fewer units; a wider box, more.
  assert.ok(sliceUnits(boxStl(100, 100, 10), 0.28, 100) < sliceUnits(box, 0.2, 100));
  assert.ok(sliceUnits(boxStl(200, 100, 10), 0.2, 100) > sliceUnits(box, 0.2, 100));
  // A call carries the infill: callUnits reads it from slice_stl's fourth argument.
  assert.equal(callUnits("slice_stl", [big as Uint8Array<ArrayBuffer>, 0.2, 3, 100, "off"], () => undefined), sliceUnits(big, 0.2, 100));
  assert.equal(callUnits("print_file_stl", [big as Uint8Array<ArrayBuffer>, 0.2, 3, 0, "off", "textured"], () => undefined), sliceUnits(big, 0.2, 0));
  // Infill nonsense is the default's: never NaN units.
  assert.ok(Number.isFinite(sliceUnits(box, 0.2, NaN)));
});
