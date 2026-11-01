// The P1S build area (build-area.ts): placements worked by hand from the
// engine's rule (the plate 256 × 256 mm, the front 5 mm strip, the corner
// x < 18, y < 28 kept clear, 250 mm high), 0.9×/1.1× style boundaries on
// each limit, and seeded random parts judged against the shipped engine
// itself: the box says "outside" exactly when Slice for printing refuses
// the part as off the plate. FISSION_SEED (decimal) picks the seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { buildArea, keepOutMoves, P1S_AREA, type AreaMesh } from "../src/build-area.ts";

/** A box from (x0, y0, z0) to (x1, y1, z1) as a mesh (its 8 corners, 12 triangles). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AreaMesh {
  const positions: number[] = [];
  for (let i = 0; i < 8; i++) positions.push(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0);
  const indices = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5];
  return { positions, indices };
}

test("a 20 mm cube anywhere in the design fits, with the plate centred under it", () => {
  // Centre (110, -40) → by = (128 − 110, 128 + 40) = (18, 168): the plate's corner is at the design's (−18, −168).
  const a = buildArea([box(100, -50, 5, 120, -30, 25)])!;
  assert.equal(a.outside, null);
  assert.deepEqual(a.lo, [-18, -168, 5]);
  assert.deepEqual(a.hi, [256 - 18, 256 - 168, 5 + 250]);
  assert.deepEqual(a.strip, [-18, -168, 238, -163]);
  assert.deepEqual(a.corner, [-18, -168, 0, -140]);
  assert.equal(buildArea([]), null);
});

test("width and depth at the plate's limits", () => {
  // 256 wide exactly fits (centred, from 0 to 256); 256.1 does not.
  assert.equal(buildArea([box(0, 0, 0, 256, 10, 1)])!.outside, null);
  assert.match(buildArea([box(0, 0, 0, 256.1, 10, 1)])!.outside!, /^Too big for the P1S's plate: the bodies shown are 256\.1 mm wide \(256 × 256 mm fits\)\.$/);
  // Depth: centred, a part d deep starts at y = 128 − d/2, in the 5 mm strip when d > 246; it moves back
  // 5 − (128 − d/2), so it fits when 128 + d/2 + that ≤ 256, i.e. d ≤ 251. 250.9 fits, 251.1 does not.
  assert.equal(buildArea([box(0, 0, 0, 10, 250.9, 1)])!.outside, null);
  assert.match(buildArea([box(0, 0, 0, 10, 251.1, 1)])!.outside!, /^Too deep for the P1S: the bodies shown are 251\.1 mm deep, and the front 5 mm of the plate is kept for the nozzle's prime line \(251 mm fits\)\.$/);
  // Both too big: both named.
  assert.match(buildArea([box(0, 0, 0, 300, 270, 1)])!.outside!, /300 mm wide and 270 mm deep/);
});

test("the front-left corner: moved right or back when it can, refused when neither stays on the plate", () => {
  // 238 × 240: centred x from 9, y from 8: in the corner. Right 18 − 9 = 9 (to 247 + 9 = 256: on the plate);
  // back 28 − 8 = 20 (to 248 + 20 = 268: off). Right it is: fits.
  assert.equal(buildArea([box(0, 0, 0, 238, 240, 1)])!.outside, null);
  // 238.2 wide: right 9.1 takes it to 256.2: off; back still off: refused.
  assert.match(buildArea([box(0, 0, 0, 238.2, 240, 1)])!.outside!, /front-left corner/);
  // The keep-out by triangles, not the box: the triangle (40, 0), (40, 40), (0, 40) seen from above, its box from
  // (0, 0), so the box is in the corner. Its hypotenuse x + y = 40 meets y = 28 at x = 12 and x = 18 at y = 22: below
  // y = 28 its least x is 12 (6 short of 18), left of x = 18 its least y is 22 (6 short of 28). So 6 right or 6 back.
  const far: AreaMesh = { positions: [40, 0, 0, 40, 40, 0, 0, 40, 0], indices: [0, 1, 2] };
  assert.deepEqual(keepOutMoves([far], [0, 0]), [18 - 12, 28 - 22]);
  // Moved 20 right, its least x is 32: clear.
  assert.equal(keepOutMoves([far], [20, 0]), null);
});

test("height: 250 mm and less fits, more does not", () => {
  assert.equal(buildArea([box(0, 0, 0, 10, 10, 249.7)])!.outside, null);
  assert.match(buildArea([box(0, 0, 0, 10, 10, 250.3)])!.outside!, /^Too tall for the P1S: the bodies shown are 250\.3 mm tall \(250 mm fits\)\.$/);
  // Too big and too tall: both said.
  assert.match(buildArea([box(0, 0, 0, 300, 10, 260)])!.outside!, /300 mm wide .* and 260 mm tall \(250 mm fits\)\.$/);
  // The box sits on the lowest point of all the bodies.
  const a = buildArea([box(0, 0, 3, 10, 10, 9), box(20, 0, -2, 30, 10, 1)])!;
  assert.equal(a.lo[2], -2);
  assert.equal(a.hi[2], 248);
});

/** xorshift64*, seeded from FISSION_SEED (decimal) or a fixed seed. */
function rng(fallback: bigint) {
  let x = BigInt(process.env.FISSION_SEED ?? fallback) || 1n;
  console.log(`FISSION_SEED=${x}`);
  const M = (1n << 64n) - 1n;
  return () => {
    x ^= x >> 12n;
    x ^= (x << 25n) & M;
    x ^= x >> 27n;
    return Number(((x * 0x2545f4914f6cdd1dn) & M) >> 11n) / 2 ** 53;
  };
}

/** The triangles of binary STL bytes as a mesh (each triangle its own three corners). */
function stlMesh(b: Uint8Array): AreaMesh {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(80, true);
  const positions: number[] = [];
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) positions.push(v.getFloat32(84 + 50 * t + 12 + 4 * k, true));
  return { positions, indices: positions.map((_, i) => i).filter((i) => i < positions.length / 3) };
}

test("seeded random parts: the box goes red exactly when the engine refuses the part as off the plate", async () => {
  const kernel = nodeKernel();
  const r = rng(20261101n);
  // Sizes round each limit (256 wide, 251 deep, the corner's 238 and 228), and parts of two bodies (an L: a bar and a disc).
  const near = (limit: number) => limit + (r() - 0.5) * 6;
  let refused = 0;
  const cases = Number(process.env.FISSION_CASES ?? 50);
  for (let c = 0; c < cases; c++) {
    const specs: BodySpec[] = [];
    // Kinds: 0 width near 256; 1 depth near 251; 2 in the corner, only right clears it (238 wide); 3 an L; 4 in the
    // corner, only back clears it (250 wide, 228 deep).
    const kind = c % 5;
    const w = kind === 0 ? near(256) : kind === 2 ? near(238) : kind === 4 ? near(250) : 20 + r() * 200;
    const d = kind === 1 ? near(251) : kind === 2 ? near(240) : kind === 3 || kind === 4 ? near(228) : 20 + r() * 200;
    specs.push({ moved: { body: { box: { width: w, depth: kind === 3 ? 10 : d, height: 1 } }, moves: [{ move: [r() * 50 - 25, r() * 50 - 25, 0] }] } });
    if (kind === 3) {
      // An L: a bar along x and a disc at its far end making it d deep; the disc's round side faces the corner or not.
      specs.push({ moved: { body: { cylinder: { radius: 10 + r() * 20, height: 1 } }, moves: [{ move: [r() < 0.5 ? 0 : w, d, 0] }] } });
    }
    const files = await Promise.all(specs.map((s) => kernel.call("export_stl", s, "body")));
    const stl = new Uint8Array(files.reduce((n, f) => n + f.bytes.length, 0));
    let at = 0;
    for (const f of files) stl.set(f.bytes, at), (at += f.bytes.length);
    const ours = buildArea(files.map((f) => stlMesh(f.bytes)))!;
    let engine: string | null = null;
    try {
      await kernel.call("print_file_stl", stl, 0.2, 2, 15, "off", "textured", "standard");
    } catch (e) {
      engine = e instanceof Error ? e.message : String(e);
    }
    const what = `case ${c} (kind ${kind}, ${w.toFixed(2)} × ${d.toFixed(2)}): ours ${ours.outside ?? "fits"}; engine ${engine ?? "sliced"}`;
    if (engine !== null) assert.match(engine, /bed|plate|corner|strip/, what);
    assert.equal(ours.outside !== null, engine !== null, what);
    if (engine) refused++;
  }
  // Both outcomes common, or the comparison proves little.
  assert.ok(refused > cases / 5 && refused < (4 * cases) / 5, `refused ${refused} of ${cases}`);
});

test("planted break: a rule without the prime line's strip disagrees with the engine on a part 251.5 mm deep", async () => {
  // The engine refuses it (251 mm fits); the right rule says so; with the strip taken as 0 the rule calls it fine (256
  // fits), so the comparison above would catch such a mistake.
  const kernel = nodeKernel();
  const f = await kernel.call("export_stl", { box: { width: 20, depth: 251.5, height: 1 } }, "body");
  await assert.rejects(kernel.call("print_file_stl", f.bytes, 0.2, 2, 15, "off", "textured", "standard"), /strip/);
  assert.match(buildArea([stlMesh(f.bytes)])!.outside!, /prime line/);
  assert.equal(buildArea([stlMesh(f.bytes)], { ...P1S_AREA, primeStrip: 0 })!.outside, null);
});

test("the eye's choice is kept in this browser's storage, shut at first, and blocked storage never throws", async () => {
  const { buildAreaShownIn, keepBuildAreaShown, BUILD_AREA_KEY } = await import("../src/build-area.ts");
  const kept = new Map<string, string>();
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
  assert.equal(buildAreaShownIn(storage), false);
  keepBuildAreaShown(storage, true);
  assert.equal(kept.get(BUILD_AREA_KEY), "shown");
  assert.equal(buildAreaShownIn(storage), true);
  keepBuildAreaShown(storage, false);
  assert.equal(kept.has(BUILD_AREA_KEY), false);
  assert.equal(buildAreaShownIn(storage), false);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(buildAreaShownIn(blocked), false);
  keepBuildAreaShown(blocked, true);
  assert.equal(buildAreaShownIn(null), false);
});
