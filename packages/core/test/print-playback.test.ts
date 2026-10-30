// The print preview's playback (H2b, H2c): G-code laid out on the clock, layer by layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARC_STEP, kindOf, layerDone, momentAt, playback } from "../src/print/playback.ts";

const close = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol;
/** Filament (mm) for `mm3` of plastic: 1.75 mm filament, area π × 0.875². */
const A = Math.PI * 0.875 * 0.875;

// Two layers by hand. Layer 1 at z 0.2: an outer wall along x then up y, then sparse infill back along
// y = 10; layer 2 at z 0.4: one outer wall line. Each line is 10 mm × 0.4 wide × 0.2 high = 0.8 mm³.
const line = 0.8 / A;
const TWO_LAYERS = [
  "G90", "M82", "G92 E0",
  "G1 Z0.2 F600", //                          0.2 mm at 10 mm/s: 0.02 s, a travel
  ";TYPE:Outer wall",
  `G1 X10 Y0 E${line} F1200`, //              10 mm at 20 mm/s: 0.5 s
  `G1 X10 Y10 E${2 * line}`, //                0.5 s
  ";TYPE:Sparse infill",
  `G1 X0 Y10 E${3 * line}`, //                 0.5 s
  "G1 Z0.4 F600", //                          0.02 s, a travel
  ";TYPE:Outer wall",
  `G1 X10 Y10 E${4 * line} F1200`, //          0.5 s
].join("\n");

test("hand-worked: two layers on the clock", () => {
  const p = playback(TWO_LAYERS);
  assert.deepEqual(p.problems, []);
  assert.equal(p.count, 6);
  assert.equal(p.plasticCount, 4);
  // Clock: 0.02, then three lines of 0.5 s (to 1.52), the 0.02 s lift (to 1.54), the last line (to 2.04).
  assert.ok(close(p.seconds, 2.04), `seconds ${p.seconds}`);
  assert.deepEqual([...p.start].map((s) => Math.round(s * 1000)), [0, 20, 520, 1020, 1520, 1540]);
  assert.deepEqual([...p.plastic], [0, 1, 1, 1, 0, 1]);
  assert.deepEqual(p.kind, ["other", "outer-wall", "outer-wall", "sparse-infill", "sparse-infill", "outer-wall"]);
  // drawn: how many plastic pieces come before each piece.
  assert.deepEqual([...p.drawn], [0, 0, 1, 2, 3, 3]);
  assert.deepEqual([...p.layer], [-1, 0, 0, 0, 0, 1]);
  assert.equal(p.layers.length, 2);
  const [one, two] = p.layers;
  assert.deepEqual([one.first, one.end, two.first, two.end], [0, 3, 3, 4]);
  assert.ok(close(one.z, 0.2) && close(one.height, 0.2) && close(two.z, 0.4) && close(two.height, 0.2, 1e-12));
  assert.ok(close(one.start, 0.02) && close(one.finish, 1.52) && close(two.start, 1.54) && close(two.finish, 2.04));
  // Width from the volume, as a printed bead: a 0.2 mm tall rectangle with half-round sides, so area
  // (w − h) × h + π(h/2)². The area is 0.8 mm³ ÷ 10 mm = 0.08 mm², so w − 0.2 = (0.08 − 0.0314159…) ÷ 0.2
  // = 0.242920…, w = 0.442920… mm (the same as 0.08 ÷ 0.2 + 0.2 × (1 − π/4) = 0.4 + 0.042920…).
  for (const i of [1, 2, 3, 5]) assert.ok(close(p.width[i], 0.4 + 0.2 * (1 - Math.PI / 4), 1e-9), `width ${p.width[i]}`);
  assert.equal(p.width[0], 0);
});

test("hand-worked: the moment a quarter of the way along the first wall", () => {
  const p = playback(TWO_LAYERS);
  // t = 0.02 + 0.125: the first wall (0 to 10 along x, 0.5 s) is a quarter done, so the nozzle is at x 2.5.
  const m = momentAt(p, 0.145)!;
  assert.equal(m.piece, 1);
  assert.ok(close(m.along, 0.25, 1e-9));
  assert.ok(close(m.nozzle[0], 2.5, 1e-9) && close(m.nozzle[1], 0) && close(m.nozzle[2], 0.2));
  assert.equal(m.laid, 0);
  assert.equal(m.layer, 0);
  // At 1.53 s the nozzle is halfway up the lift between layers: three lines laid, z 0.3.
  const lift = momentAt(p, 1.53)!;
  assert.equal(lift.piece, 4);
  assert.equal(lift.laid, 3);
  assert.ok(close(lift.nozzle[2], 0.3, 1e-9));
  // The very end: everything laid, the nozzle at the last line's end.
  const end = momentAt(p, 99)!;
  assert.equal(end.laid, 4);
  assert.deepEqual(end.nozzle, [10, 10, 0.4]);
  // On a boundary the next piece is running, at its start: at 0.52 s the first wall is done and the second begins.
  const edge = momentAt(p, 0.52)!;
  assert.deepEqual([edge.piece, edge.along, edge.laid], [2, 0, 1]);
  // Before the start, and a clock that isn't a number, are the start.
  assert.deepEqual(momentAt(p, -5)!.nozzle, [0, 0, 0]);
  assert.equal(momentAt(p, Number.NaN)!.piece, 0);
});

test("a layer slider and the time-lapse share one clock", () => {
  const p = playback(TWO_LAYERS);
  assert.ok(close(layerDone(p, 0), 1.52));
  assert.ok(close(layerDone(p, 1), 2.04));
  // Out of range is clamped to the first or the last layer.
  assert.ok(close(layerDone(p, -3), 1.52) && close(layerDone(p, 7), 2.04));
  // At the end of layer 1 exactly, all of its three lines are laid and none of layer 2's.
  assert.equal(momentAt(p, layerDone(p, 0))!.laid, 3);
});

test("hand-worked: a half-turn arc is cut into 5° pieces sharing its time", () => {
  // G3 from (10, 0) round the centre (0, 0) to (−10, 0): 180°, 36 pieces of 5°. Length π × 10 at 20 mm/s.
  const p = playback(["G90", "M82", "G92 E0", "G1 X10 Y0 Z0.2 F6000", ";TYPE:Inner wall", "G3 X-10 Y0 I-10 J0 E1 F1200"].join("\n"));
  assert.deepEqual(p.problems, []);
  assert.equal(Math.round(Math.PI / ARC_STEP), 36);
  assert.equal(p.plasticCount, 36);
  const arc = p.count - 36;
  assert.ok(close(p.finish[p.count - 1] - p.start[arc], (Math.PI * 10) / 20, 1e-9));
  // The 18th piece ends at 90°: (0, 10). Every piece end lies on the circle of radius 10.
  assert.ok(close(p.to[3 * (arc + 17)], 0, 1e-9) && close(p.to[3 * (arc + 17) + 1], 10, 1e-9));
  for (let i = arc; i < p.count; i++) assert.ok(close(Math.hypot(p.to[3 * i], p.to[3 * i + 1]), 10, 1e-9));
  assert.deepEqual([p.to[3 * (p.count - 1)], p.to[3 * (p.count - 1) + 1]], [-10, 0]);
  assert.ok(p.kind.slice(arc).every((k) => k === "inner-wall"));
});

test("travels, retractions and primes are never plastic and never start a layer", () => {
  const p = playback(["G90", "M83", "G1 Z0.2 F600", "G1 E-0.8 F2400", "G0 X30 Y40 F6000", "G1 E0.8 F2400", "G0 Z5"].join("\n"));
  assert.equal(p.plasticCount, 0);
  assert.equal(p.layers.length, 0);
  assert.ok(p.count > 0);
  assert.equal(layerDone(p, 0), 0);
});

test("the slicer's feature names as kinds", () => {
  assert.equal(kindOf("Outer wall"), "outer-wall");
  assert.equal(kindOf(" inner wall "), "inner-wall");
  assert.equal(kindOf("Solid infill"), "solid-infill");
  assert.equal(kindOf("Sparse infill"), "sparse-infill");
  assert.equal(kindOf("Support interface"), "support");
  assert.equal(kindOf("Prime line"), "prime");
  assert.equal(kindOf("Gap fill"), "other");
  assert.equal(kindOf(undefined), "other");
});

const ALPHABET = "G1XYZEFIJ 0123456789.-;\n:TYPE";
test("nothing to play: empty text, and random bytes never throw", () => {
  const empty = playback("");
  assert.equal(empty.count, 0);
  assert.equal(momentAt(empty, 1), null);
  let seed = Number(process.env.FISSION_SEED ?? 20261030) >>> 0;
  const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 200; k++) {
    const text = Array.from({ length: 200 }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join("");
    const p = playback(text);
    // Whatever it read, the clock only runs forwards and the layers cover the plastic once each.
    for (let i = 0; i < p.count; i++) assert.ok(p.finish[i] >= p.start[i] && (i === 0 || p.start[i] === p.finish[i - 1]));
    assert.equal(p.layers.reduce((n, l) => n + l.end - l.first, 0), p.plasticCount);
  }
});
