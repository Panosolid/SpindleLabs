// The replay checks (src/gcode-checks.ts, Slice P0b): a good file, written
// here by hand for a part whose numbers are worked out below, passes them
// all; each check is then shown a fault planted in that file and must
// report it, and each limit is tried at 0.9× and 1.1×.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, STILL } from "../src/gcode.ts";
import { checkLayers, checkPrinter, checkTravel, checkVolume, crosses, extremes, layersOf, MAX_LAYER, MIN_LAYER, type Printer } from "../src/gcode-checks.ts";

const A = Math.PI * 0.875 ** 2; // 1.75 mm filament's cross-section, mm²
const fmt = (v: number) => v.toFixed(9).replace(/\.?0+$/, "");

/** A printer like the owner's: 256 mm bed and height, 500 mm/s, 300 °C nozzle, 110 °C bed. */
const P1S: Printer = { bed: { x: 256, y: 256 }, height: 256, maxFeed: 30000, maxNozzle: 300, maxBed: 110 };

interface BoxOptions {
  layers?: number;
  /** Each layer's height, from the bed; defaults to 0.2 each. */
  heights?: number[];
  /** Multiplies every E. */
  flow?: number;
  /** Multiplies only the infill's E. */
  infillFlow?: number;
  /** Stop the outer wall this far short of its start (mm), on layer 0. */
  outerShort?: number;
  /** Leave out the outer wall's last side on layer 0. */
  dropSide?: boolean;
  /** An extra travel across the part on layer 0, retracted first or not. */
  crossTravel?: "retracted" | "not-retracted";
  extra?: string[];
}

/**
 * A 20 × 20 mm box on the bed at (118, 118), printed as a 0.4 mm outer wall, a 0.4 mm inner wall and solid
 * lines of infill, with 0.4 mm lines throughout.
 *
 * Worked by hand, per layer at height h: the outer wall's centre line is the square 0.2 in from the edge,
 * side 19.6, so its bead covers 4 × 19.6 × 0.4 = 31.36 mm² (a closed square band, nothing to take off at the
 * corners, as in gcode.test.ts); the inner wall's is side 18.8: 4 × 18.8 × 0.4 = 30.08 mm². Inside them is
 * the square from 0.8 to 19.2, 18.4 a side, filled by 46 lines 0.4 apart, each laying down an 18.4 × 0.4
 * strip: 46 × 7.36 = 338.56 mm². Total 31.36 + 30.08 + 338.56 = 400 mm² = the box's 20 × 20, so each
 * layer is 400 h mm³ and ten 0.2 mm layers are 800 mm³, the box's own volume.
 */
function box(o: BoxOptions = {}): string {
  const heights = o.heights ?? Array<number>(o.layers ?? 10).fill(0.2);
  const flow = o.flow ?? 1;
  const ox = 118;
  const oy = 118;
  const L: string[] = ["M140 S60", "M104 S220", "M190 S60", "M109 S220", "G28", "G90", "M83", "G92 E0"];
  let z = 0;
  const filament = (area: number, h: number, f = 1) => fmt(((area * h) / A) * flow * f);
  heights.forEach((h, layer) => {
    z += h;
    const loop = (inset: number, feature: string, short = 0, drop = false) => {
      const lo = inset;
      const hi = 20 - inset;
      const side = hi - lo;
      const pts = [[hi, lo], [hi, hi], [lo, hi], [lo, lo]];
      L.push(`;TYPE:${feature}`);
      L.push(`G0 X${fmt(ox + lo)} Y${fmt(oy + lo)} F12000`);
      L.push("G1 E0.8 F2400"); // prime what the travel's retraction pulled back
      L.push("G1 F3000");
      pts.forEach(([x, y], k) => {
        if (drop && k === 3) return;
        const last = k === 3;
        const len = last ? side - short : side;
        const ex = last ? ox + lo : ox + x;
        const ey = last ? oy + lo + short : oy + y;
        L.push(`G1 X${fmt(ex)} Y${fmt(ey)} E${filament(len * 0.4, h)}`);
      });
      L.push("G1 E-0.8 F2400");
    };
    // Up to the layer's height first (still retracted from the last layer).
    L.push(`G0 Z${fmt(z)} F6000`);
    // Each loop starts by priming 0.8 mm, so the first layer pulls that back before it starts.
    if (layer === 0) L.push("G1 E-0.8 F2400");
    loop(0.2, "Outer wall", layer === 0 ? (o.outerShort ?? 0) : 0, layer === 0 && o.dropSide === true);
    loop(0.6, "Inner wall");
    L.push(";TYPE:Solid infill");
    L.push("G1 E0.8 F2400");
    for (let k = 0; k < 46; k++) {
      const y = oy + 1.0 + 0.4 * k;
      const [x0, x1] = k % 2 === 0 ? [ox + 0.8, ox + 19.2] : [ox + 19.2, ox + 0.8];
      L.push(`G0 X${fmt(x0)} Y${fmt(y)} F12000`);
      L.push(`G1 X${fmt(x1)} Y${fmt(y)} E${filament(18.4 * 0.4, h, o.infillFlow ?? 1)} F3000`);
    }
    if (layer === 0 && o.crossTravel) {
      if (o.crossTravel === "retracted") L.push("G1 E-0.8 F2400");
      L.push(`G0 X${fmt(ox - 5)} Y${fmt(oy + 10)} F12000`); // out across the walls to the left
      L.push(`G0 X${fmt(ox + 19.2)} Y${fmt(oy + 18.6)} F12000`); // and back in to the last line's end
      if (o.crossTravel === "retracted") L.push("G1 E0.8 F2400");
    }
    L.push("G1 E-0.8 F2400");
  });
  L.push(...(o.extra ?? []));
  L.push("M104 S0", "M140 S0");
  return L.join("\n");
}

test("hand-worked: the good box passes every check, and lays down its own 800 mm³", () => {
  const r = replay(box());
  assert.deepEqual(r.problems, []);
  // 10 layers × 400 mm² × 0.2 mm = 800 mm³ (worked in `box`).
  assert.ok(Math.abs(r.volume - 800) < 1e-6, `volume ${r.volume}`);
  assert.equal(layersOf(r).length, 10);
  assert.deepEqual(layersOf(r).map((l) => Number(l.z.toFixed(6))), [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]);
  assert.deepEqual(checkVolume(r, 800, 0.001), []);
  assert.deepEqual(checkPrinter(r, P1S), []);
  assert.deepEqual(checkTravel(r), []);
  assert.deepEqual(checkLayers(r, 0.01), []);
});

test("volume: 2 % less infill is caught at a 1 % allowance; the allowance at 0.9× passes and 1.1× fails", () => {
  // Infill is 338.56 of the 400 mm² (84.64 %): 2 % less of it is 1.693 % less plastic, past 1 %.
  const thin = replay(box({ infillFlow: 0.98 }));
  assert.ok(Math.abs(thin.volume - 800 * (1 - 0.02 * 0.8464)) < 1e-6);
  assert.deepEqual(checkVolume(thin, 800, 0.01).map((p) => p.check), ["volume"]);
  // Every E 0.9 × 5 % over: 4.5 % off, passes a 5 % allowance; 1.1 × 5 % over: 5.5 % off, fails.
  assert.deepEqual(checkVolume(replay(box({ flow: 1 + 0.9 * 0.05 })), 800, 0.05), []);
  assert.deepEqual(checkVolume(replay(box({ flow: 1 + 1.1 * 0.05 })), 800, 0.05).map((p) => p.check), ["volume"]);
  assert.deepEqual(checkVolume(replay(box({ flow: 1 - 1.1 * 0.05 })), 800, 0.05).map((p) => p.check), ["volume"]);
  // A file with nothing in it is caught too, and a NaN volume can't slip through.
  assert.deepEqual(checkVolume(replay(""), 800, 0.05).map((p) => p.check), ["volume"]);
  assert.deepEqual(checkVolume({ ...replay(""), volume: NaN }, 800, 0.05).map((p) => p.check), ["volume"]);
});

test("printer: off the bed, too high, too fast or too hot is caught, each at its line", () => {
  const off = replay(box({ extra: ["G0 X256.001 Y10 F12000"] }));
  assert.deepEqual(checkPrinter(off, P1S).map((p) => p.check), ["bed"]);
  const edge = replay(box({ extra: ["G0 X256 Y256 F12000", "G0 X0 Y0"] }));
  assert.deepEqual(checkPrinter(edge, P1S), []);
  const below = replay(box({ extra: ["G0 X10 Y-0.001 F12000"] }));
  assert.deepEqual(checkPrinter(below, P1S).map((p) => p.check), ["bed"]);
  const high = replay(box({ extra: ["G0 Z256.5 F600"] }));
  assert.deepEqual(checkPrinter(high, P1S).map((p) => p.check), ["height"]);
  const fast = replay(box({ extra: ["G0 X10 Y10 F30001"] }));
  assert.deepEqual(checkPrinter(fast, P1S).map((p) => p.check), ["feed"]);
  const hot = replay(box({ extra: ["M104 S301", "M140 S111"] }));
  assert.deepEqual(checkPrinter(hot, P1S).map((p) => [p.check, p.line > 0]), [["temperature", true], ["temperature", true]]);
});

test("hand-worked: an arc whose ends are on the bed but which bulges off it is caught", () => {
  // From (250, 100) counter-clockwise round (250, 128) to (250, 156): a half turn of radius 28. Starting at
  // the bottom and turning counter-clockwise it goes right first, through (278, 128), 22 mm off the 256 mm
  // bed, though both its ends are on the bed.
  const r = replay(["G90", "G0 X250 Y100 F6000", "G3 X250 Y156 I0 J28"].join("\n"));
  assert.deepEqual(r.problems, []);
  const furthest = extremes(r.moves[1]).map((p) => Math.round(p.x));
  assert.ok(furthest.includes(278), `${furthest}`);
  assert.deepEqual(checkPrinter(r, P1S).map((p) => p.check), ["bed"]);
  // The same ends clockwise go left, through (222, 128): on the bed.
  const left = replay(["G90", "G0 X250 Y100 F6000", "G2 X250 Y156 I0 J28"].join("\n"));
  assert.deepEqual(checkPrinter(left, P1S), []);
});

test("travel: crossing the walls without retracting is caught; retracted first it passes", () => {
  assert.deepEqual(checkTravel(replay(box({ crossTravel: "retracted" }))), []);
  const bad = replay(box({ crossTravel: "not-retracted" }));
  const found = checkTravel(bad);
  // Out across the walls and back in: two travels, both crossing.
  assert.deepEqual(found.map((p) => p.check), ["travel", "travel"]);
  // Only plastic already laid on the layer counts in the strict check: a travel over where this layer's
  // infill will go, before it is printed, crosses nothing.
  const early = replay(["G90", "M83", ";TYPE:Outer wall", "G0 X10 Y10 Z0.2 F6000", "G1 X20 Y10 E1 F3000", "G0 X15 Y5", "G0 X15 Y15", ";TYPE:Solid infill", "G1 X15 Y5 E1"].join("\n"));
  // The travel (15, 5) → (15, 15) crosses the wall (10, 10)–(20, 10) laid before it: caught. The infill
  // printed after it along the same line doesn't add a second problem.
  assert.deepEqual(checkTravel(early).map((p) => [p.check, p.line]), [["travel", 7]]);
  // Travels lay nothing down: one travel crossing an earlier one is fine.
  const twice = replay(["G90", "M83", ";TYPE:Outer wall", "G0 X10 Y10 Z0.2 F6000", "G1 X11 Y10 E1 F3000", "G0 X30 Y30", "G0 X30 Y40", "G0 X25 Y35", "G0 X35 Y35"].join("\n"));
  assert.deepEqual(checkTravel(twice), []);
});

test("travel: with the outlines given, crossing infill unretracted is fine but crossing the outline is not", () => {
  const outline = [{ x: 118, y: 118 }, { x: 138, y: 118 }, { x: 138, y: 138 }, { x: 118, y: 138 }];
  const walls = Array.from({ length: 10 }, (_, i) => ({ z: 0.2 * (i + 1), outlines: [outline] }));
  // A travel across the infill, inside the outline, unretracted: strict mode refuses it, outline mode allows it.
  const across = ["G0 X128 Y119.5 F12000", "G0 X128 Y137.5"];
  const r = replay(box({ layers: 1, extra: ["G1 E0.8 F2400", ...across] }));
  // (118.8, 137) → (128, 119.5) and (128, 119.5) → (128, 137.5) both cross infill lines already printed.
  assert.deepEqual(checkTravel(r).map((p) => p.check), ["travel", "travel"]);
  assert.deepEqual(checkTravel(r, walls), []);
  const out = replay(box({ crossTravel: "not-retracted" }));
  assert.deepEqual(checkTravel(out, walls).map((p) => p.check), ["travel", "travel"]);
});

test("crossing: only a proper crossing counts, not a touch at an end or a run along", () => {
  const p = (x: number, y: number) => ({ x, y });
  assert.equal(crosses(p(0, 0), p(2, 2), p(0, 2), p(2, 0)), true);
  assert.equal(crosses(p(0, 0), p(1, 1), p(1, 1), p(2, 0)), false); // meet at an end
  assert.equal(crosses(p(0, 0), p(2, 0), p(1, 0), p(3, 0)), false); // along each other
  assert.equal(crosses(p(0, 0), p(1, 0), p(2, -1), p(2, 1)), false); // would meet if longer
  assert.equal(crosses(p(0, 0), p(2, 0), p(1, 0), p(1, 1)), false); // a T: one end on the other
  assert.equal(crosses(p(1, 0), p(1, 1), p(0, 0), p(2, 0)), false); // the same T the other way round
});

test("layers: decision 7's limits at 0.9× and 1.1×, and a layer going back down", () => {
  const at = (h: number) => checkLayers(replay(box({ heights: [0.2, h, 0.2] })), 0.01).map((p) => p.check);
  assert.deepEqual(at(1.1 * MIN_LAYER), []);
  assert.deepEqual(at(0.9 * MIN_LAYER), ["layer-height"]);
  assert.deepEqual(at(0.9 * MAX_LAYER), []);
  assert.deepEqual(at(1.1 * MAX_LAYER), ["layer-height"]);
  // The first layer is measured from the bed.
  assert.deepEqual(checkLayers(replay(box({ heights: [0.9 * MIN_LAYER, 0.2] })), 0.01).map((p) => p.check), ["layer-height"]);
  // A layer printed under the one before.
  const down = replay(box({ heights: [0.2, 0.2], extra: [";TYPE:Solid infill", "G0 Z0.3 F600", "G1 E0.8", "G1 X120 Y120 E0.1 F3000"] }));
  assert.deepEqual(checkLayers(down, 0.01).map((p) => p.check), ["layer-order"]);
});

/** Layers `first`, first + h, first + 2h… written as Z with `decimals` places, as slicers write them: one 1 mm line each. */
function stack(h: number, layers: number, decimals: number, first = h): string {
  const L = ["G90", "M83", ";TYPE:Sparse infill"];
  for (let k = 0; k < layers; k++) {
    L.push(`G0 Z${(first + k * h).toFixed(decimals)} F600`, `G1 X${(k + 1) % 2} Y0 E0.05 F600`);
  }
  return L.join("\n");
}

test("regression: layers exactly at 0.04 mm and 1.0 mm, Z written rounded, are not refused", () => {
  // Found by the slicer walls work: 0.12 − 0.08 is 0.03999999999999999 in floating point, so before the
  // rounding allowance 201 of 500 layers of a 0.04 mm print were reported as too thin; 8.3 − 7.3 is
  // 1.0000000000000009, so 1 mm layers from a 0.3 mm first layer were reported as too thick.
  assert.equal(0.12 - 0.08 < MIN_LAYER, true);
  assert.equal(8.3 - 7.3 > MAX_LAYER, true);
  for (const decimals of [2, 3, 5]) {
    assert.deepEqual(checkLayers(replay(stack(MIN_LAYER, 500, decimals)), 0.01), [], `0.04 mm, ${decimals} places`);
    assert.deepEqual(checkLayers(replay(stack(MAX_LAYER, 200, decimals, 0.3)), 0.01), [], `1.0 mm, ${decimals} places`);
  }
  // 0.1 mm layers up to 260 mm (most of them a hair under 0.1 once subtracted).
  assert.deepEqual(checkLayers(replay(stack(0.1, 2600, 2)), 0.01), []);
});

test("the rounding allowance is STILL: a layer STILL × 0.9 past a limit passes, STILL × 1.1 is refused", () => {
  const two = (h: number) => checkLayers(replay(["G90", "M83", ";TYPE:Sparse infill", "G0 Z0.2 F600", "G1 X1 E0.05", `G0 Z${(0.2 + h).toFixed(12)}`, "G1 X0 E0.05"].join("\n")), 0.01).map((p) => p.check);
  assert.deepEqual(two(MIN_LAYER - 0.9 * STILL), []);
  assert.deepEqual(two(MIN_LAYER - 1.1 * STILL), ["layer-height"]);
  assert.deepEqual(two(MAX_LAYER + 0.9 * STILL), []);
  assert.deepEqual(two(MAX_LAYER + 1.1 * STILL), ["layer-height"]);
});

test("walls: a wall missing a side is open; closing within closeWithin at 0.9× passes and 1.1× fails", () => {
  assert.deepEqual(checkLayers(replay(box({ dropSide: true })), 0.01).map((p) => p.check), ["open-wall"]);
  assert.deepEqual(checkLayers(replay(box({ outerShort: 0.9 * 0.05 })), 0.05), []);
  assert.deepEqual(checkLayers(replay(box({ outerShort: 1.1 * 0.05 })), 0.05).map((p) => p.check), ["open-wall"]);
  // Infill lines are never walls, so they are never asked to close.
  assert.deepEqual(checkLayers(replay(box()), 0), []);
});
